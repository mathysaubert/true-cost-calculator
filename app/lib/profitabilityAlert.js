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
