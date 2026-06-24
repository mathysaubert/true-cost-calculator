// ── UI Monitor — agrégats d'historique : fonction PURE et testable ──────────
// Code PUR (aucun I/O / React). Entrée = lignes order_margins STOCKÉES, sortie =
// regroupements + sommes des colonnes existantes. AUCUNE marge re-dérivée : on ne
// fait QUE grouper et sommer line_net_margin / line_net_revenue / effective_qty
// déjà calculés par engine.js à l'ingestion. (C'est le pendant lecture du BUG 1 :
// jamais de prixVente−coutRendu inline.)

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Jour calendaire UTC de order_created_at (le VRAI jour de la commande, pas computed_at).
function utcDay(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function aggregateOrderMargins(rows = []) {
  // [C] cost_source='missing' (marges null) : exclu des agrégats/courbe/rentabilité,
  // rangé à part. Les compter 0 ou perte serait faux.
  const missingCostRows = [];
  const valid = [];
  for (const r of rows) {
    if (r.cost_source === "missing" || r.line_net_margin == null) missingCostRows.push(r);
    else valid.push(r);
  }

  const currencies = [...new Set(valid.map((r) => r.currency_code).filter(Boolean))];
  const multiCurrency = currencies.length > 1;

  // [A] Agrégat PAR PRODUIT (jamais ligne par ligne) — non rentable = Σ marge < 0.
  const prodMap = new Map();
  for (const r of valid) {
    const key = r.product_id ?? "__unknown__";
    let p = prodMap.get(key);
    if (!p) { p = { product_id: r.product_id ?? null, orderIds: new Set(), effective_qty: 0, net_revenue: 0, net_margin: 0, currencySet: new Set() }; prodMap.set(key, p); }
    p.orderIds.add(r.order_id);
    p.effective_qty += num(r.effective_qty);
    p.net_revenue   += num(r.line_net_revenue);
    p.net_margin    += num(r.line_net_margin);
    if (r.currency_code) p.currencySet.add(r.currency_code);
  }
  const byProduct = [...prodMap.values()].map((p) => ({
    product_id:    p.product_id,
    orders:        p.orderIds.size,
    effective_qty: p.effective_qty,
    net_revenue:   p.net_revenue,
    net_margin:    p.net_margin,
    marginPct:     p.net_revenue > 0 ? (p.net_margin / p.net_revenue) * 100 : null, // CA=0 → null (pas de /0)
    unprofitable:  p.net_margin < 0,
    currency:      p.currencySet.size === 1 ? [...p.currencySet][0] : (p.currencySet.size === 0 ? null : "MIXED"),
  }));

  // [B] Agrégat PAR JOUR (UTC) — deux séries quotidiennes (pas de cumul).
  const dayMap = new Map();
  for (const r of valid) {
    const day = utcDay(r.order_created_at);
    if (!day) continue;
    let d = dayMap.get(day);
    if (!d) { d = { day, net_revenue: 0, net_margin: 0 }; dayMap.set(day, d); }
    d.net_revenue += num(r.line_net_revenue);
    d.net_margin  += num(r.line_net_margin);
  }
  const byDay = [...dayMap.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const unprofitableProducts = byProduct.filter((p) => p.unprofitable);

  // Totaux GLOBAUX (à n'afficher que mono-devise — la couche UI gate sur multiCurrency).
  const totals = {
    net_revenue: valid.reduce((s, r) => s + num(r.line_net_revenue), 0),
    net_margin:  valid.reduce((s, r) => s + num(r.line_net_margin), 0),
    orders:      new Set(valid.map((r) => r.order_id)).size,
  };

  return {
    byProduct, byDay,
    unprofitableProducts, unprofitableCount: unprofitableProducts.length,
    missingCostRows, missingCount: missingCostRows.length,
    currencies, multiCurrency,
    totals, validCount: valid.length,
  };
}
