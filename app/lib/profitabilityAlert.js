// ── Alerting produit-à-perte — diff d'état PUR (aucun I/O, aucun React) ──────
// Compare l'état de rentabilité COURANT par produit (sortie aggregateOrderMargins.byProduct)
// à l'état STOCKÉ au dernier run (product_profitability_state). AUCUNE marge recalculée :
// on COMPARE des sommes déjà produites par le moteur/l'agrégat (net_margin, net_revenue).
//
// Décisions produit (cf. Phase 0) :
//   • SEUIL configurable (% global boutique) : sous le seuil ⟺ net_margin < (T/100) × net_revenue.
//     Pure comparaison de deux sommes stockées — jamais de division, jamais de null.
//     T = 0 (défaut) → net_margin < 0 : EXACTEMENT le legacy (perte STRICTE). Non-régression.
//   • état BINAIRE conservé : 'profitable' | 'loss'. La FRONTIÈRE bouge (0 → T), pas le
//     vocabulaire → zéro migration des lignes existantes, zéro faux basculement au déploiement.
//   • produits multi-devises ('MIXED') : JAMAIS suivis (somme cross-devise interdite).
//   • product_id null (produit supprimé) : non suivi (clé non stockable, non actionnable).
//   • basculement = état courant ≠ état stocké (uniquement si un état existait).
//   • produit sans état antérieur (nouveau / premier passage) → SEED, jamais d'alerte.
//
// Entrées :
//   current      : aggregateOrderMargins(...).byProduct
//                  [{ product_id, net_margin, net_revenue, marginPct, currency, ... }]
//   prevStateMap : Map(product_id → { last_state: 'profitable'|'loss' })
//   thresholdPct : seuil % global boutique (shop_plans.profitability_threshold_pct), défaut 0.
// Sortie (3 listes DISJOINTES) :
//   basculements : { product_id, state, margin, marginPct, currency, from, to } → mail + écriture (après envoi)
//   seeds        : { product_id, state, margin, marginPct, currency }            → écriture, PAS d'alerte
//   majNormales  : { product_id, state, margin, marginPct, currency }            → écriture (maj), PAS d'alerte
import { formatMoney } from "./orderHistory.js";

const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };

// Nom lisible d'un produit : titre résolu par l'appelant (Admin API) sinon fin du gid.
const productName = (b) => b.title ?? `Produit ${String(b.product_id ?? "").split("/").pop()}`;

// ── Poste de coût dominant d'un produit — PUR (aucune re-dérivation, BUG 1) ───
// Entrée : costPosts agrégés par aggregateOrderMargins (€ produit). On EXCLUT le coût d'achat+port
// (structurel, connu = coutRendu − douane − TVA import) du classement et on l'expose à part ;
// on classe les SURCHARGES (ce que le marchand ne voit pas venir) et on renvoie la plus lourde.
// CONSTAT, jamais conseil : le libellé n'est qu'un nom de poste + un montant.
const POST_LABELS = {
  douane:      "la douane",
  tvaNetCost:  "la TVA à l'import non récupérable",
  shopifyCost: "les frais Shopify",
  stripeCost:  "les frais de paiement",
  retoursCost: "les retours",
  fraisFixes:  "les frais fixes (emballage, retour)",
};
export function dominantCostPost(costPosts) {
  if (!costPosts) return null;
  const achatPort = num(costPosts.coutRendu) - num(costPosts.douane) - num(costPosts.tvaNetCost);
  let top = null;
  for (const k of Object.keys(POST_LABELS)) {
    const v = num(costPosts[k]);
    if (v > 0 && (!top || v > top.amount)) top = { label: POST_LABELS[k], amount: v };
  }
  return top ? { ...top, achatPort } : null;  // null si aucune surcharge > 0 → mail n'affiche rien
}

// ── Rendu PUR du mail d'alerte (digest) — aucun I/O, aucun envoi ────────────
// Wording NEUTRE, basé sur l'ÉTAT, jamais causal ("votre dernière vente…") ni daté
// ("30 derniers jours") : le cron ne connaît que l'agrégat, pas la cause.
// SOUS-GROUPAGE (apport du seuil) : un basculement 'loss' distingue deux niveaux d'urgence —
//   • marge < 0          → "Passés à perte" (perte réelle d'argent)
//   • 0 ≤ marge < seuil  → "Sous votre seuil" (encore rentable, mais sous l'objectif)
// Cette distinction se dérive AU RENDU du signe de la marge — aucun 3ᵉ état stocké.
// Entrée : { shop, thresholdPct, basculements:[{ to:'loss'|'profitable', margin, marginPct, currency, title? }] }.
// Sortie : { subject, html, text } prêts pour Resend.
export function renderLossAlertEmail({ shop, thresholdPct = 0, basculements = [] }) {
  const losses     = basculements.filter((b) => b.to === "loss");
  const realLosses = losses.filter((b) => num(b.margin) < 0);   // perte réelle
  const thin       = losses.filter((b) => num(b.margin) >= 0);  // sous le seuil mais rentable
  const recoveries = basculements.filter((b) => b.to === "profitable");
  const subject = `⚠️ ${shop} — ${basculements.length} produit(s) ont changé de rentabilité`;

  const seuilLabel = num(thresholdPct) > 0
    ? ` de ${num(thresholdPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "";
  const fmtPct = (p) => p == null ? null
    : `${num(p).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  // Montant au centime + % à côté (le % est null si CA = 0 → on n'affiche que le montant).
  const amount = (b) => { const pct = fmtPct(b.marginPct); const m = formatMoney(b.margin, b.currency); return pct ? `${m} · ${pct}` : m; };

  const lossLine = (b) => `${productName(b)} — marge nette cumulée négative (${amount(b)}) sur vos commandes suivies.`;
  const thinLine = (b) => `${productName(b)} — marge nette sous votre seuil${seuilLabel} (${amount(b)}).`;
  const recoLine = (b) => `${productName(b)} — repassé au-dessus du seuil${seuilLabel} (${amount(b)}).`;

  const lines = [];
  if (realLosses.length) lines.push("Passés à perte :", ...realLosses.map(lossLine));
  if (thin.length)       lines.push("Sous votre seuil :", ...thin.map(thinLine));
  if (recoveries.length) lines.push("Repassés au-dessus du seuil :", ...recoveries.map(recoLine));
  const text = lines.join("\n");

  const section = (titre, items, render) => items.length
    ? `<h3 style="margin:16px 0 6px;font-size:14px">${titre}</h3><ul style="margin:0;padding-left:18px">${items.map((b) => `<li style="margin:4px 0">${render(b)}</li>`).join("")}</ul>`
    : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#202223;line-height:1.5">
    <p>Changement de rentabilité détecté sur <strong>${shop}</strong>.</p>
    ${section("Passés à perte", realLosses, lossLine)}
    ${section("Sous votre seuil", thin, thinLine)}
    ${section("Repassés au-dessus du seuil", recoveries, recoLine)}
  </div>`;

  return { subject, html, text };
}

export function computeProfitabilityChanges(current = [], prevStateMap = new Map(), thresholdPct = 0) {
  const basculements = [];
  const seeds = [];
  const majNormales = [];

  for (const p of current) {
    if (p.product_id == null) continue;        // produit supprimé → non stockable / non actionnable
    if (p.currency === "MIXED") continue;       // cross-devise → jamais suivi

    // Frontière SEUIL : sous le seuil ⟺ net_margin < (T/100) × net_revenue.
    // T = 0 → net_margin < 0 : reproduit le legacy AU CAS PRÈS (y compris CA = 0), sans /0 ni null.
    const below = num(p.net_margin) < (num(thresholdPct) / 100) * num(p.net_revenue);
    const state = below ? "loss" : "profitable";
    const entry = { product_id: p.product_id, state, margin: p.net_margin, marginPct: p.marginPct ?? null, currency: p.currency ?? null };

    const prev = prevStateMap.get(p.product_id);
    if (!prev) { seeds.push(entry); continue; }            // pas d'état antérieur → seed silencieux
    if (prev.last_state !== state) basculements.push({ ...entry, from: prev.last_state, to: state });
    else majNormales.push(entry);
  }

  return { basculements, seeds, majNormales };
}
