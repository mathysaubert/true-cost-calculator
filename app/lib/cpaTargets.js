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
const DAY_MS = 86_400_000;

// Obsolescence du CPA DÉCLARÉ : les marges sont dérivées d'une fenêtre de 30 jours de commandes
// (orderSync windowStart = now − 30 j). Comparer le plafond (frais de 30 j) à un CPA déclaré plus
// ancien que cette fenêtre est incohérent → au-delà, l'écart est marqué stale (l'UI le grise et
// invite à remettre à jour, au lieu d'afficher un vert « validé » trompeur).
export const CPA_STALE_DAYS = 30;

// Budget disponible pour l'acquisition (avant pub), après réserve de seuil. Pure soustraction
// de sommes serveur : net_margin − (seuil/100)×CA. Seuil 0 → = net_margin (break-even).
export function availableForAds(netMargin, netRevenue, thresholdPct = 0) {
  return num(netMargin) - (num(thresholdPct) / 100) * num(netRevenue);
}

export function computeCpaTargets(agg, { thresholdPct = 0, currentCpa = null, currentCpaUpdatedAt = null, now = Date.now(), staleDays = CPA_STALE_DAYS } = {}) {
  const byProduct = agg?.byProduct ?? [];

  // Par produit : marge disponible / unité. margeDispoUnite null ⇒ unavailableReason DIT pourquoi
  // (l'UI rend un "—" explicite + tooltip, jamais une cellule vide ambiguë) :
  //   "mixed_currency" → produit multi-devises (somme cross-devise interdite) ;
  //   "no_units"       → effective_qty ≤ 0 (produit entièrement remboursé : rien à acquérir —
  //                      son éventuel saignement reste porté par la colonne Marge nette / badge « À perte »).
  const perProduct = byProduct.map((p) => {
    const qty = num(p.effective_qty);
    let margeDispoUnite = null;
    let unavailableReason = null;
    if (p.currency === "MIXED")      unavailableReason = "mixed_currency";
    else if (qty <= 0)               unavailableReason = "no_units";
    else margeDispoUnite = availableForAds(p.net_margin, p.net_revenue, thresholdPct) / qty;
    return {
      product_id: p.product_id ?? null,
      currency: p.currency ?? null,
      margeDispoUnite,
      unavailableReason,
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
  // stale = le CPA déclaré est plus vieux que la fenêtre (ou sans date fiable) → l'UI grise
  // l'écart et invite à le remettre à jour, plutôt qu'un vert/rouge « frais » trompeur (B1).
  let ecart = null;
  if (blended && currentCpa != null && Number.isFinite(+currentCpa)) {
    const value = blended.cpaMax - num(currentCpa);
    const ageMs = currentCpaUpdatedAt ? (now - Date.parse(currentCpaUpdatedAt)) : NaN;
    const stale = !Number.isFinite(ageMs) || ageMs >= staleDays * DAY_MS;
    ecart = { value, currentCpa: num(currentCpa), overspend: value < 0, stale };
  }

  // Signal INCONDITIONNEL (indépendant du tri UI) : combien de produits ne supportent AUCUNE
  // acquisition payante (marge dispo/unité ≤ 0). L'UI l'affiche dès que > 0, à côté du blended.
  const exhaustedCount = perProduct.filter((x) => x.exhausted).length;

  return { perProduct, blended, ecart, exhaustedCount };
}
