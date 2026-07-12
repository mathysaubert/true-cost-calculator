// ── Cibles d'acquisition — dérivation PURE (aucun I/O, aucun React) ──────────
// Consomme les agrégats DÉJÀ produits par aggregateOrderMargins (orderHistory.js). Rappel
// décisif : net_margin y est la marge AVANT pub (ads=0 est passé à computeMargin à l'ingestion,
// orderIngest.js) → AUCUNE marge n'est recalculée ici. On ne fait que (a) soustraire la réserve
// de seuil et (b) diviser par une quantité / un nombre de commandes — deux agrégats serveur.
// BUG 1 : rien de tout ceci ne doit vivre dans le JSX ; le client n'affiche que formatMoney(...).
//
// Nommage (décision produit — le mot « CPA » n'apparaît QUE là où il est vrai) :
//   • PAR PRODUIT → « marge disponible / unité » = (net_margin − seuil×CA) / effective_qty.
//     Ce N'EST PAS un CPA (division par des unités, pas des conversions). exhausted = ≤ 0
//     → le produit ne supporte AUCUNE acquisition payante.
//   • BLENDED (boutique, mono-devise) → vrai « CPA max » = (Σnet_margin − seuil×ΣCA) / commandes
//     DISTINCTES (totals.orders). Légitime : au niveau boutique, conversions = commandes uniques,
//     donc pas de double attribution multi-produits (contrairement à Σ produit.orders ≥ totals.orders).
//
// Seuil = profitability_threshold_pct (0 par défaut = break-even pur). currentCpa = CPA blended
// DÉCLARÉ par le marchand (jamais mesuré par l'app) → sert à l'écart, avec sa date côté UI.

const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };

// Budget disponible pour l'acquisition (avant pub), après réserve de seuil. Pure soustraction
// de sommes serveur : net_margin − (seuil/100)×CA. Seuil 0 → = net_margin (break-even).
export function availableForAds(netMargin, netRevenue, thresholdPct = 0) {
  return num(netMargin) - (num(thresholdPct) / 100) * num(netRevenue);
}

export function computeCpaTargets(agg, { thresholdPct = 0, currentCpa = null } = {}) {
  const byProduct = agg?.byProduct ?? [];

  // Par produit : marge disponible / unité. null si devise mixte (somme cross-devise interdite)
  // ou quantité nulle (pas de division par zéro).
  const perProduct = byProduct.map((p) => {
    const qty = num(p.effective_qty);
    const margeDispoUnite = (p.currency === "MIXED" || qty <= 0)
      ? null
      : availableForAds(p.net_margin, p.net_revenue, thresholdPct) / qty;
    return {
      product_id: p.product_id ?? null,
      currency: p.currency ?? null,
      margeDispoUnite,
      exhausted: margeDispoUnite != null && margeDispoUnite <= 0,
    };
  });

  // Blended : uniquement mono-devise et s'il existe au moins une commande distincte.
  let blended = null;
  if (!agg?.multiCurrency && num(agg?.totals?.orders) > 0) {
    blended = {
      cpaMax: availableForAds(agg.totals.net_margin, agg.totals.net_revenue, thresholdPct) / num(agg.totals.orders),
      currency: agg.currencies?.[0] ?? null,
    };
  }

  // Écart vs CPA déclaré : seulement si blended dispo ET une valeur saisie finie.
  let ecart = null;
  if (blended && currentCpa != null && Number.isFinite(+currentCpa)) {
    const value = blended.cpaMax - num(currentCpa);
    ecart = { value, currentCpa: num(currentCpa), overspend: value < 0 };
  }

  return { perProduct, blended, ecart };
}
