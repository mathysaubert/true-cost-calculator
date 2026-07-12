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

// Obsolescence du CPA DÉCLARÉ : c'est un POINT FIXE saisi par le marchand qui VIEILLIT, comparé à
// une marge MESURÉE et recalculée à chaque sync (fenêtre glissante, toujours fraîche). Ce n'est
// donc PAS une comparaison structurellement saine — c'est une approximation « valeur déclarée vs
// marge mesurée ». Au-delà de CPA_STALE_DAYS (≈ un mois de campagnes — convention, pas un
// alignement de fenêtres), on grise l'écart et on invite à remettre à jour, plutôt qu'un vert
// « validé » trompeur. Le wording UI DOIT assumer l'approximation, jamais prétendre l'inverse.
export const CPA_STALE_DAYS = 30;

// Budget disponible pour l'acquisition (avant pub), après réserve de seuil. Pure soustraction
// de sommes serveur : net_margin − (seuil/100)×CA. Seuil 0 → = net_margin (break-even).
export function availableForAds(netMargin, netRevenue, thresholdPct = 0) {
  return num(netMargin) - (num(thresholdPct) / 100) * num(netRevenue);
}

export function computeCpaTargets(agg, { thresholdPct = 0, currentCpa = null, currentCpaUpdatedAt = null, now = Date.now(), staleDays = CPA_STALE_DAYS } = {}) {
  const byProduct = agg?.byProduct ?? [];

  // MACHINE À ÉTATS explicite (un seul point de vérité ; l'UI ne fait que switcher sur state).
  // Exactement 5 états, mutuellement exclusifs :
  //   "ok"              → margeDispoUnite > 0 (montant affichable) ;
  //   "no_acquisition"  → margeDispoUnite ≤ 0 : vend mais ne peut financer AUCUNE acquisition
  //                        (0 € de budget = déjà aucune acquisition possible → frontière ≤ 0) ;
  //   "value_destroyed" → 0 unité vendue ET net_margin < 0 : tout remboursé À PERTE (frais/retours) ;
  //   "no_units"        → 0 unité vendue, net_margin ≥ 0 : remboursement neutre → "—" neutre ;
  //   "mixed_currency"  → multi-devises : somme cross-devise interdite → "—" neutre.
  const perProduct = byProduct.map((p) => {
    const qty = num(p.effective_qty);
    let state, margeDispoUnite = null;
    if (p.currency === "MIXED") {
      state = "mixed_currency";
    } else if (qty <= 0) {
      state = num(p.net_margin) < 0 ? "value_destroyed" : "no_units";
    } else {
      margeDispoUnite = availableForAds(p.net_margin, p.net_revenue, thresholdPct) / qty;
      state = margeDispoUnite <= 0 ? "no_acquisition" : "ok"; // === 0 → no_acquisition (frontière ≤ 0)
    }
    return { product_id: p.product_id ?? null, currency: p.currency ?? null, margeDispoUnite, state };
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
    const overspend = value < 0;
    const ageMs = currentCpaUpdatedAt ? (now - Date.parse(currentCpaUpdatedAt)) : NaN;
    const stale = !Number.isFinite(ageMs) || ageMs >= staleDays * DAY_MS;
    // gapLabel + gapAmount (magnitude ABSOLUE) calculés SERVEUR → le JSX ne fait que rendre :
    // aucun Math.abs, aucune comparaison de marge côté client (BUG 1).
    ecart = {
      value, currentCpa: num(currentCpa), overspend, stale,
      gapLabel: overspend ? "Dépassement" : "Marge de manœuvre",
      gapAmount: Math.abs(value),
    };
  }

  // Signaux INCONDITIONNELS (indépendants du tri UI) — comptés SÉPARÉMENT (deux problèmes, deux
  // remèdes ; on ne conflate pas « marge ≤ 0 » et « CA détruit », mais on n'en cache aucun) :
  //   noAcqCount        → vend mais ne peut financer aucune acquisition (state no_acquisition) ;
  //   valueDestroyedCount → entièrement remboursé à perte (state value_destroyed).
  const noAcqCount          = perProduct.filter((x) => x.state === "no_acquisition").length;
  const valueDestroyedCount = perProduct.filter((x) => x.state === "value_destroyed").length;

  return { perProduct, blended, ecart, noAcqCount, valueDestroyedCount };
}
