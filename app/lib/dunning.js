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

// FROZEN_GRACE_DAYS est IMPORTÉ de plan.js (la borne d'entitlement, planEntitlement) — jamais
// redéfini ici : le mail conditionnel et le gating partagent ainsi UNE seule source de vérité et ne
// peuvent structurellement pas diverger (une modif future de la grâce s'applique aux deux d'un coup).
import { FROZEN_GRACE_DAYS } from "./plan.js";

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
// Ton FACTUEL et AIDANT : on énonce le FAIT (paiement échoué) et la conséquence À VENIR
// (résiliation possible par Shopify si rien n'est régularisé), JAMAIS un verrouillage ACTUEL faux
// (l'accès continue pendant la grâce, cf. renderDunningEmail), ni de fausse urgence / dark pattern
// ("DERNIÈRE CHANCE", compte à rebours, rareté factice). L'incitation vient du fait, pas de
// l'emphase. Le LIEN de régularisation est TOUJOURS présent (le cron n'envoie qu'avec une URL valide).

const planLabel = (plan) => (plan ? `votre abonnement ${plan}` : "votre abonnement");

// Mail de relance (épisode frozen). Entrée : { shop, plan, confirmationUrl, frozenSince, now }.
// VÉRITÉ DE L'ÉTAT conditionnelle à l'ÂGE DU GEL — mesuré avec le MÊME frozen_since et la MÊME
// constante FROZEN_GRACE_DAYS (importée de plan.js) que la borne d'entitlement planEntitlement :
//   • grâce EN COURS  (now - frozenSince <= FROZEN_GRACE_DAYS) : l'accès CONTINUE (Shopify maintient,
//     et notre app entitle FROZEN) → coupure seulement À VENIR. Les fonctions payantes (suivi de
//     marge, alertes sans garde de plan ; audit Expert ouvert via la grâce) sont bien disponibles.
//   • grâce EXPIRÉE   (now - frozenSince >  FROZEN_GRACE_DAYS) : la borne d'entitlement a coupé →
//     l'accès aux fonctions payantes EST suspendu, rétabli dès régularisation. Le mail le dit alors.
// Comparaison INCLUSIVE (<=), IDENTIQUE à plan.js:61-65 : mail et gating partagent la borne exacte,
// impossible de diverger. DÉFAUT SÛR : frozenSince absent/illisible (edge — rendu hors épisode, ou
// R1 dont frozen_since n'est pas encore stampé) → withinGrace = true (branche "accès continue").
// On n'annonce JAMAIS une suspension à tort ; au pire on dit "continue" à un déjà-suspendu, jamais
// l'inverse. Même règle null→grâce que planEntitlement. Lien de régularisation TOUJOURS présent.
export function renderDunningEmail({ shop, plan, confirmationUrl, frozenSince = null, now = Date.now() }) {
  const subject = "Le paiement de votre abonnement True Cost Calculator a échoué";
  const lien = confirmationUrl;

  const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));
  const frozenSinceMs = frozenSince == null ? null : toMs(frozenSince);
  const withinGrace =
    frozenSinceMs == null || !Number.isFinite(frozenSinceMs)
      ? true
      : toMs(now) - frozenSinceMs <= FROZEN_GRACE_DAYS * DAY_MS;

  // Une ligne par paragraphe (jamais de coupure au milieu d'une phrase → meilleur rendu plain-text
  // et parité HTML/texte : les mêmes expressions restent intactes). Le client mail gère le wrapping.
  const bodyText = withinGrace
    ? [
        `Le paiement de ${planLabel(plan)} n'a pas pu être prélevé. Shopify va réessayer automatiquement. En attendant, votre accès à True Cost Calculator continue — vos fonctionnalités restent disponibles pour le moment.`,
        ``,
        `Si le paiement n'aboutit pas, Shopify finira par résilier l'abonnement, et l'accès aux fonctionnalités payantes s'arrêtera à ce moment-là. Le délai dépend de la politique de facturation de Shopify. Régularisez votre paiement pour éviter cette coupure à venir. Vos données sont conservées dans tous les cas.`,
      ]
    : [
        `Le paiement de ${planLabel(plan)} n'a pas pu être prélevé, et l'accès aux fonctionnalités payantes de True Cost Calculator est maintenant suspendu. Il est rétabli dès que votre paiement est régularisé. Vos données sont conservées.`,
        ``,
        `Régularisez votre paiement pour rétablir l'accès. Shopify continue de réessayer le prélèvement ; le délai de résiliation dépend de sa politique de facturation.`,
      ];

  const text = [
    ...bodyText,
    ``,
    `Régulariser votre paiement :`,
    lien,
    ``,
    `Déjà régularisé ? Vous pouvez ignorer ce message.`,
  ].join("\n");

  const bodyHtml = withinGrace
    ? `<p>Le paiement de <strong>${planLabel(plan)}</strong> n'a pas pu être prélevé. Shopify va réessayer automatiquement. En attendant, <strong>votre accès à True Cost Calculator continue</strong> — vos fonctionnalités restent disponibles pour le moment.</p>
    <p>Si le paiement n'aboutit pas, Shopify finira par résilier l'abonnement, et l'accès aux fonctionnalités payantes s'arrêtera à ce moment-là. Le délai dépend de la politique de facturation de Shopify. Régularisez votre paiement pour éviter cette coupure à venir. <strong>Vos données sont conservées dans tous les cas.</strong></p>`
    : `<p>Le paiement de <strong>${planLabel(plan)}</strong> n'a pas pu être prélevé, et <strong>l'accès aux fonctionnalités payantes de True Cost Calculator est maintenant suspendu</strong>. Il est rétabli dès que votre paiement est régularisé. <strong>Vos données sont conservées.</strong></p>
    <p>Régularisez votre paiement pour rétablir l'accès. Shopify continue de réessayer le prélèvement ; le délai de résiliation dépend de sa politique de facturation.</p>`;

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#202223;line-height:1.6">
    ${bodyHtml}
    <p style="margin:20px 0">
      <a href="${lien}" style="display:inline-block;padding:10px 18px;background:#008060;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Régulariser mon paiement</a>
    </p>
    <p style="font-size:12px;color:#6D7175">Ou copiez ce lien : <a href="${lien}">${lien}</a></p>
    <p style="font-size:12px;color:#6D7175">Déjà régularisé ? Vous pouvez ignorer ce message.</p>
  </div>`;

  return { subject, html, text };
}

// Mail de confirmation (retour à active après relances). Entrée : { shop, plan }. Sobre.
export function renderDunningResolvedEmail({ shop, plan }) {
  const subject = "C'est réglé — votre accès est rétabli";
  const text = [
    `Votre paiement est passé et ${planLabel(plan)} est réactivé.`,
    `Vous avez de nouveau accès à toutes les fonctionnalités de True Cost Calculator.`,
    `Merci !`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#202223;line-height:1.6">
    <p>Votre paiement est passé et <strong>${planLabel(plan)}</strong> est réactivé.</p>
    <p>Vous avez de nouveau accès à toutes les fonctionnalités de True Cost Calculator.</p>
    <p>Merci !</p>
  </div>`;
  return { subject, html, text };
}
