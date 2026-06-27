// ── Alerting produit-à-perte — diff d'état PUR (aucun I/O, aucun React) ──────
// Compare l'état de rentabilité COURANT par produit (sortie aggregateOrderMargins.byProduct)
// à l'état STOCKÉ au dernier run (product_profitability_state). AUCUNE marge recalculée :
// on lit le signe de net_margin (= Σ line_net_margin) déjà produit par le moteur/l'agrégat.
//
// Décisions produit (cf. Phase 0) :
//   • perte STRICTE : état = net_margin < 0 ? 'loss' : 'profitable'.
//   • produits multi-devises ('MIXED') : JAMAIS suivis (somme cross-devise interdite).
//   • product_id null (produit supprimé) : non suivi (clé non stockable, non actionnable).
//   • basculement = état courant ≠ état stocké (uniquement si un état existait).
//   • produit sans état antérieur (nouveau / premier passage) → SEED, jamais d'alerte.
//
// Entrées :
//   current      : aggregateOrderMargins(...).byProduct
//                  [{ product_id, net_margin, unprofitable, currency, ... }]
//   prevStateMap : Map(product_id → { last_state: 'profitable'|'loss' })
// Sortie (3 listes DISJOINTES) :
//   basculements : { product_id, state, margin, currency, from, to }  → mail + écriture (après envoi)
//   seeds        : { product_id, state, margin, currency }            → écriture, PAS d'alerte
//   majNormales  : { product_id, state, margin, currency }            → écriture (maj), PAS d'alerte
import { formatMoney } from "./orderHistory.js";

// Nom lisible d'un produit : titre résolu par l'appelant (Admin API) sinon fin du gid.
const productName = (b) => b.title ?? `Produit ${String(b.product_id ?? "").split("/").pop()}`;

// ── Rendu PUR du mail d'alerte (digest) — aucun I/O, aucun envoi ────────────
// Wording NEUTRE, basé sur l'ÉTAT, jamais causal ("votre dernière vente…") ni daté
// ("30 derniers jours") : le cron ne connaît que l'agrégat, pas la cause. Deux sections.
// Entrée : { shop, basculements:[{ product_id, to:'loss'|'profitable', margin, currency, title? }] }.
// Sortie : { subject, html, text } prêts pour Resend.
export function renderLossAlertEmail({ shop, basculements = [] }) {
  const losses     = basculements.filter((b) => b.to === "loss");
  const recoveries = basculements.filter((b) => b.to === "profitable");
  const subject = `⚠️ ${shop} — ${basculements.length} produit(s) ont changé de rentabilité`;

  const lossLine = (b) => `${productName(b)} — marge nette cumulée désormais négative (${formatMoney(b.margin, b.currency)}) sur vos commandes suivies.`;
  const recoLine = (b) => `${productName(b)} — repassé rentable (${formatMoney(b.margin, b.currency)}).`;

  const lines = [];
  if (losses.length)     lines.push("Passés à perte :", ...losses.map(lossLine));
  if (recoveries.length) lines.push("Redevenus rentables :", ...recoveries.map(recoLine));
  const text = lines.join("\n");

  const section = (titre, items, render) => items.length
    ? `<h3 style="margin:16px 0 6px;font-size:14px">${titre}</h3><ul style="margin:0;padding-left:18px">${items.map((b) => `<li style="margin:4px 0">${render(b)}</li>`).join("")}</ul>`
    : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#202223;line-height:1.5">
    <p>Changement de rentabilité détecté sur <strong>${shop}</strong>.</p>
    ${section("Passés à perte", losses, lossLine)}
    ${section("Redevenus rentables", recoveries, recoLine)}
  </div>`;

  return { subject, html, text };
}

export function computeProfitabilityChanges(current = [], prevStateMap = new Map()) {
  const basculements = [];
  const seeds = [];
  const majNormales = [];

  for (const p of current) {
    if (p.product_id == null) continue;        // produit supprimé → non stockable / non actionnable
    if (p.currency === "MIXED") continue;       // cross-devise → jamais suivi

    const state = p.unprofitable ? "loss" : "profitable";
    const entry = { product_id: p.product_id, state, margin: p.net_margin, currency: p.currency ?? null };

    const prev = prevStateMap.get(p.product_id);
    if (!prev) { seeds.push(entry); continue; }            // pas d'état antérieur → seed silencieux
    if (prev.last_state !== state) basculements.push({ ...entry, from: prev.last_state, to: state });
    else majNormales.push(entry);
  }

  return { basculements, seeds, majNormales };
}
