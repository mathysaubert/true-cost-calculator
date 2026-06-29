// ── Dunning — décision PURE de relance (aucun I/O, aucun React, aucun réseau) ─
// Cœur du dunning, pendant de computeProfitabilityChanges : à partir du STATUT
// d'abonnement COURANT (lu à l'instant T par le cron via allSubscriptions) et de l'état
// de dunning STOCKÉ (subscription_dunning_state), décide UNE action. Le cron exécute,
// puis n'avance le compteur/la date qu'APRÈS un envoi réussi (garde-fou G2).
//
// Les 3 pièges sont verrouillés ICI, par construction :
//   1. Jamais relancer un 'active'/'cancelled' → seul 'frozen' peut produire 'send_dunning'.
//   2. Jamais dépasser le plafond → 'frozen' avec count ≥ max ⇒ 'nothing'.
//   3. Jamais relancer après 'cancelled' → 'cancelled' ⇒ 'stop_cancelled' (aucun mail de relance).
//
// Cadence : ~2 relances/semaine = espacement minimal de 3 jours (la cadence vit dans la
// DONNÉE — last_dunning_at —, pas dans le schedule du cron, qui tourne quotidiennement).

export const DUNNING_MAX = 5;            // plafond de relances par épisode frozen
export const DUNNING_INTERVAL_DAYS = 3;  // espacement minimal entre deux relances
const DAY_MS = 86_400_000;

// ── Dérivation du statut COURANT depuis l'historique allSubscriptions — PURE ──
// allSubscriptions renvoie TOUT l'historique (ACTIVE/FROZEN/PENDING/CANCELLED/EXPIRED…),
// souvent du bruit (annulations/expirations de tests passés). On ne se fie JAMAIS au volume :
// précédence ACTIVE > FROZEN > PENDING > cancelled. 'cancelled' = plus aucun actif/frozen/pending.
// Retourne aussi le frozenNode (pour recréer la charge au MÊME prix). Entrée = [{ status, name, lineItems }].
export function deriveSubscriptionStatus(nodes = []) {
  if (nodes.some((n) => n?.status === "ACTIVE")) return { status: "active", frozenNode: null };
  const frozenNode = nodes.find((n) => n?.status === "FROZEN");
  if (frozenNode) return { status: "frozen", frozenNode };
  if (nodes.some((n) => n?.status === "PENDING")) return { status: "pending", frozenNode: null };
  return { status: "cancelled", frozenNode: null };
}

// Reconstruit les line items RÉCURRENTS d'un sub (gelé) en entrée de appSubscriptionCreate —
// au MÊME prix/intervalle (jamais sous-facturer ; aucune table de prix en dur à maintenir).
// Ignore tout pricing non récurrent. Entrée = node.lineItems de allSubscriptions.
export function recurringLineItems(node) {
  return (node?.lineItems ?? [])
    .map((li) => li?.plan?.pricingDetails)
    .filter((pd) => pd && pd.__typename === "AppRecurringPricing" && pd.price)
    .map((pd) => ({ plan: { appRecurringPricingDetails: {
      price: { amount: Number(pd.price.amount), currencyCode: pd.price.currencyCode },
      interval: pd.interval,
    } } }));
}

// Actions possibles (le cron mappe chacune sur un effet) :
//   'send_dunning'   → recréer une charge + mail de relance, puis count++ / last_dunning_at=now
//   'send_resolved'  → mail "c'est réglé" (une fois), puis reset count=0
//   'stop_cancelled' → marquer cancelled, plus jamais de mail
//   'nothing'        → ne rien faire (cadence non écoulée, plafond atteint, statut neutre…)
export function decideDunningAction({
  status,
  state = {},
  now = Date.now(),
  maxDunning = DUNNING_MAX,
  intervalDays = DUNNING_INTERVAL_DAYS,
} = {}) {
  const count = Number.isFinite(+state.dunning_count) ? +state.dunning_count : 0;
  const lastAt = state.last_dunning_at ? Date.parse(state.last_dunning_at) : NaN;
  // Première relance (jamais relancé) OU délai écoulé → cadence OK.
  const intervalElapsed = !Number.isFinite(lastAt) || (now - lastAt) >= intervalDays * DAY_MS;

  switch (status) {
    case "frozen":
      if (count >= maxDunning) return "nothing";   // plafond atteint → ne JAMAIS spammer
      if (!intervalElapsed)    return "nothing";    // cadence pas encore écoulée
      return "send_dunning";
    case "active":
      return count > 0 ? "send_resolved" : "nothing"; // "réglé" seulement si on relançait
    case "cancelled":
      return "stop_cancelled";                        // Shopify a tranché → stop définitif
    default:
      return "nothing";                               // pending, expired, inconnu → rien
  }
}

// ── Rendus PURS des mails de dunning — aucun I/O, aucun envoi ────────────────
// Ton FACTUEL : on énonce la conséquence RÉELLE (paiement échoué → accès suspendu tant que
// non régularisé), jamais de fausse urgence / dark pattern ("DERNIÈRE CHANCE", compte à
// rebours, rareté factice). L'incitation vient du fait, pas de l'emphase. Le LIEN de
// régularisation est TOUJOURS présent (le cron ne déclenche l'envoi qu'avec une URL valide).

const planLabel = (plan) => (plan ? `votre abonnement ${plan}` : "votre abonnement");

// Mail de relance (épisode frozen). Entrée : { shop, plan, confirmationUrl }.
export function renderDunningEmail({ shop, plan, confirmationUrl }) {
  const subject = "Paiement en échec — votre abonnement True Cost Calculator est suspendu";
  const lien = confirmationUrl;

  const text = [
    `Le dernier paiement de ${planLabel(plan)} n'a pas abouti.`,
    `Shopify a suspendu l'abonnement : les fonctionnalités payantes de True Cost Calculator`,
    `resteront indisponibles tant que le paiement n'est pas régularisé.`,
    ``,
    `Pour rétablir votre accès, régularisez votre paiement ici :`,
    lien,
    ``,
    `Si vous avez déjà régularisé, vous pouvez ignorer ce message.`,
  ].join("\n");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#202223;line-height:1.6">
    <p>Le dernier paiement de <strong>${planLabel(plan)}</strong> n'a pas abouti.</p>
    <p>Shopify a suspendu l'abonnement : les fonctionnalités payantes de True Cost Calculator resteront indisponibles tant que le paiement n'est pas régularisé.</p>
    <p style="margin:20px 0">
      <a href="${lien}" style="display:inline-block;padding:10px 18px;background:#008060;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Régulariser mon paiement</a>
    </p>
    <p style="font-size:12px;color:#6D7175">Ou copiez ce lien : <a href="${lien}">${lien}</a></p>
    <p style="font-size:12px;color:#6D7175">Si vous avez déjà régularisé, vous pouvez ignorer ce message.</p>
  </div>`;

  return { subject, html, text };
}

// Mail de confirmation (retour à active après relances). Entrée : { shop, plan }.
export function renderDunningResolvedEmail({ shop, plan }) {
  const subject = "Paiement à jour — accès rétabli";
  const text = [
    `Votre paiement a été régularisé et ${planLabel(plan)} est de nouveau actif.`,
    `L'accès complet à True Cost Calculator est rétabli.`,
    `Merci.`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#202223;line-height:1.6">
    <p>Votre paiement a été régularisé et <strong>${planLabel(plan)}</strong> est de nouveau actif.</p>
    <p>L'accès complet à True Cost Calculator est rétabli.</p>
    <p>Merci.</p>
  </div>`;
  return { subject, html, text };
}
