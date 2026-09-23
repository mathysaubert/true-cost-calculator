// ── Trois boutiques fictives (D4a) : saine, contribution en baisse, données manquantes ─────────
// Générateur déterministe → faits au format du loader (commandes, lignes v2, pub, coûts fixes,
// retours) → aggregate() par période. Période courante = septembre 2026 (30 jours) ; jusqu'à 4
// périodes précédentes de 30 jours. now = 2026-10-20 (tout est hors délai de retour).
import { aggregate } from "../../app/lib/econ/aggregate.js";
import { lineFromOrderMarginsRow, ordersForEngine, applyOrderDiscounts } from "../../app/lib/econ/adapters.js";

const DAY_MS = 86_400_000;
const shift = (day, n) => new Date(Date.parse(day + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
export const NOW = new Date("2026-10-20T00:00:00Z");
export const WINDOWS = [
  { start: "2026-09-01", end: "2026-09-30" },
  { start: "2026-08-02", end: "2026-08-31" },
  { start: "2026-07-03", end: "2026-08-01" },
  { start: "2026-06-03", end: "2026-07-02" },
  { start: "2026-05-04", end: "2026-06-02" },
];

export const BASE_SETTINGS = {
  shop_country_code: "FR", shop_timezone: "UTC", shop_currency: "EUR", return_window_days: 30,
  packaging_cost_per_order: 1, shipping_cost_rules: { default: 5, byCountry: {}, confirmed: true },
  gateway_fee_rules: [{ gateway: "*", pct: 2, fixed: 0.25, confirmed: true }],
  profitability_threshold_pct: 45, target_margin_after_ads_pct: 15, main_product_price: 60,
};

// Une période de faits. p : { orders, price, cogs, refundEvery, discount, unknownEvery, utmEvery,
// adSpend, fixedMonthly, secondUnitEvery }.
export function makePeriod(win, p, tag) {
  const days = Math.round((Date.parse(win.end) - Date.parse(win.start)) / DAY_MS) + 1;
  const orders = [], rows = [], returns = [];
  for (let i = 0; i < p.orders; i++) {
    const id = `${tag}-${i}`;
    const day = shift(win.start, i % days);
    const refunded = p.refundEvery > 0 && i % p.refundEvery === p.refundEvery - 1;
    const unknown = p.unknownEvery > 0 && i % p.unknownEvery === p.unknownEvery - 1;
    const attributed = p.utmEvery > 0 && i % p.utmEvery === 0;
    const qty = p.secondUnitEvery > 0 && i % p.secondUnitEvery === 0 ? 2 : 1;
    orders.push({ order_id: id, day_local: day, created_at: `${day}T10:00:00Z`, excluded_reason: null, currency_code: "EUR", discounts_amount: p.discount ?? 0, shipping_charged: 0, customer_order_index: i % 5 < 3 ? 1 : 2, utm_source: attributed ? "facebook" : null, source_name: "web", gateway_names: ["shopify_payments"], country_code: "FR", total_ttc: p.price * qty, product: p.productOf ? p.productOf(i) : "P1" });
    rows.push({ order_id: id, line_item_id: `L${id}`, product_id: p.productOf ? p.productOf(i) : "P1", variant_id: "V1", quantity: qty, refunded_qty: refunded ? qty : 0, effective_qty: refunded ? 0 : qty, unit_price_ht: p.price, tax_lines: [], is_gift_card: false, cm1_components: unknown ? null : { achat: p.cogs, port_entrant: 0, droits: 0, tva_import_non_recup: 0 }, cm1_unit: unknown ? null : p.price - p.cogs, cost_source: unknown ? "missing" : "confirmed", breakdown_version: 2, currency_code: "EUR", day_local: day });
    if (refunded) returns.push({ return_id: `R${id}`, order_id: id, status: "CLOSED", line_items: [{ line_item_id: `L${id}`, quantity: qty, return_reason: "DEFECTIVE" }] });
  }
  const adSpend = p.adSpend > 0 ? Array.from({ length: days }, (_, d) => ({ day_local: shift(win.start, d), platform: "meta", spend_shop_currency: p.adSpend / days, platform_revenue: 0, platform_orders: 0 })) : [];
  const fixedCosts = p.fixedMonthly > 0 ? [{ amount_monthly: p.fixedMonthly, active_from: null, active_to: null }] : [];
  return { window: win, orders, rows, returns, adSpend, fixedCosts };
}

export function aggregatePeriod(period, settings = BASE_SETTINGS) {
  const lines = period.rows.map(lineFromOrderMarginsRow).filter(Boolean);
  const { orders } = ordersForEngine(period.orders, { lines });
  const agg = aggregate({ orders, lines, returns: period.returns, adSpend: period.adSpend, fixedCosts: period.fixedCosts, settings, window: period.window, now: NOW });
  return { agg: applyOrderDiscounts(agg, orders, period.window), lines, orders };
}

const PROFILES = {
  // Saine : CM2 ≈ 52 % > objectif 45, remboursements rares, pub connectée, coûts fixes saisis,
  // panier 62 proche du prix principal 60 → opportunité panier.
  healthy: {
    settings: BASE_SETTINGS,
    current: { orders: 40, price: 62, cogs: 22, refundEvery: 40, discount: 0, unknownEvery: 0, utmEvery: 2, adSpend: 400, fixedMonthly: 300 },
    previous: [38, 39, 41, 40].map((n) => ({ orders: n, price: 62, cogs: 22, refundEvery: 40, discount: 0, unknownEvery: 0, utmEvery: 2, adSpend: 380, fixedMonthly: 300 })),
  },
  // Contribution en baisse : CA +10 %, coût produit 22 → 30, remboursements 2,5 % → 10 %, remises.
  declining: {
    settings: BASE_SETTINGS,
    current: { orders: 48, price: 62, cogs: 30, refundEvery: 10, discount: 4, unknownEvery: 0, utmEvery: 2, adSpend: 520, fixedMonthly: 300 },
    previous: [40, 40, 40, 40].map(() => ({ orders: 40, price: 62, cogs: 22, refundEvery: 40, discount: 0, unknownEvery: 0, utmEvery: 2, adSpend: 380, fixedMonthly: 300 })),
  },
  // Données manquantes : 12 commandes, une ligne sur deux sans coût, frais et port non confirmés,
  // pas d'emballage, pas de coûts fixes, pas de pub mais des commandes attribuées (UTM).
  missing: {
    settings: { ...BASE_SETTINGS, packaging_cost_per_order: null, shipping_cost_rules: {}, gateway_fee_rules: [{ gateway: "*", pct: 2, fixed: 0.25, confirmed: false }] },
    current: { orders: 12, price: 62, cogs: 22, refundEvery: 0, discount: 0, unknownEvery: 2, utmEvery: 3, adSpend: 0, fixedMonthly: 0 },
    previous: [{ orders: 10, price: 62, cogs: 22, refundEvery: 0, discount: 0, unknownEvery: 2, utmEvery: 3, adSpend: 0, fixedMonthly: 0 }],
  },
};

// Boutique complète : { settings, current: { agg, lines, orders, period }, previous: [{ agg, … }] }.
export function makeShop(profile) {
  const p = PROFILES[profile];
  if (!p) throw new Error(`profil inconnu : ${profile}`);
  const cur = makePeriod(WINDOWS[0], p.current, `${profile}-c`);
  const prev = p.previous.map((pp, i) => makePeriod(WINDOWS[i + 1], pp, `${profile}-p${i}`));
  return {
    profile, settings: p.settings,
    current: { period: cur, ...aggregatePeriod(cur, p.settings) },
    previous: prev.map((pe) => ({ period: pe, ...aggregatePeriod(pe, p.settings) })),
  };
}
export const PROFILE_IDS = Object.keys(PROFILES);
