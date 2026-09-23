// ── Adaptateurs faits stockés → entrées du moteur — PUR (arbitrages C6, C7 de F4) ─────────────
// aggregate() consomme la forme de computeLineEconomics ; order_margins v2 ne stocke pas tout.
// Dérivations et approximations DOCUMENTÉES (Phase 0 F4 §5.2) :
//   revenue_units        = effective_qty (même définition D4)                                  exact
//   cogs_units           = effective_qty (restocked_qty non stocké → repli A2a)                approx.
//   cout_rendu_unit      = unit_price_ht − cm1_unit                                            exact
//   tax_per_unit         = Σ tax_lines[].amount ÷ quantity                                     exact
//   unit_price_ttc       = unit_price_ht + tax_per_unit                                        exact
//   unit_price_original_ht = null → remise par ligne = 0 ; la remise de COMMANDE
//                          (orders.discounts_amount) est réinjectée au niveau boutique/jour (C7b)
// Une ligne sans breakdown_version (ingérée avant F2) n'est PAS convertible : null + compteur.
import { evaluate } from "./nodes.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

export const LINE_ENGINE_VERSION_MIN = 2;
// Raisons d'exclusion qu'une boutique de DÉVELOPPEMENT peut réintégrer (C6). Jamais les autres.
export const DEV_INCLUDABLE_REASONS = ["draft", "test"];

export function lineFromOrderMarginsRow(row) {
  if (!row || row.breakdown_version == null || num(row.breakdown_version) < LINE_ENGINE_VERSION_MIN) return null;
  if (row.unit_price_ht == null) return null;
  const quantity = int(row.quantity);
  const refunded = Math.min(quantity, int(row.refunded_qty));
  const effective = row.effective_qty == null ? quantity - refunded : Math.max(0, Math.min(quantity, int(row.effective_qty)));
  const taxTotal = (Array.isArray(row.tax_lines) ? row.tax_lines : []).reduce((s, t) => s + num(t?.amount), 0);
  const tax_per_unit = quantity > 0 ? taxTotal / quantity : 0;
  const unit_price_ht = num(row.unit_price_ht);
  const gift = row.is_gift_card === true || row.cost_source === "excluded";
  const cm1_unit = gift || row.cm1_unit == null ? null : num(row.cm1_unit);
  return {
    order_id: row.order_id, line_item_id: row.line_item_id,
    product_id: row.product_id ?? null, variant_id: row.variant_id ?? null,
    currency_code: row.currency_code ?? null, day_local: row.day_local ?? null,
    quantity, refunded_qty: refunded, restocked_qty: null,
    revenue_units: effective, cogs_units: effective, restock_known: false,
    unit_price_ht, unit_price_ttc: unit_price_ht + tax_per_unit, tax_per_unit,
    unit_price_original_ht: null,
    tax_lines: Array.isArray(row.tax_lines) ? row.tax_lines : [], is_gift_card: gift,
    cost_source: gift ? "excluded" : (row.cost_source ?? "missing"),
    cm1_components: row.cm1_components ?? null,
    cm1_unit,
    cout_rendu_unit: cm1_unit == null ? null : round2(unit_price_ht - cm1_unit),
    packaging_override_unit: null,
  };
}

// Convertit un lot de lignes ; renvoie aussi le nombre de lignes legacy (non convertibles).
export function linesFromOrderMarginsRows(rows = []) {
  const lines = []; let legacy = 0;
  for (const r of rows) { const l = lineFromOrderMarginsRow(r); if (l) lines.push(l); else legacy++; }
  return { lines, legacy };
}

// Commandes stockées → commandes moteur : port remboursé (table refunds), remappage C6.
//   includeTestOrders : true SEULEMENT si la boutique est une boutique de développement (garde en amont).
export function ordersForEngine(rows = [], { refunds = [], includeTestOrders = false } = {}) {
  const shippingRefunded = new Map();
  for (const r of refunds) if (r?.settled !== false) shippingRefunded.set(r.order_id, (shippingRefunded.get(r.order_id) ?? 0) + num(r.shipping_refunded));
  const excluded = { test: 0, draft: 0, cancelled: 0, gift_card_only: 0, b2b: 0 };
  let reincluded = 0;
  const orders = rows.map((o) => {
    let reason = o.excluded_reason ?? null;
    if (reason && includeTestOrders && DEV_INCLUDABLE_REASONS.includes(reason)) { reason = null; reincluded++; }
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    return { ...o, excluded_reason: reason, shipping_refunded: shippingRefunded.get(o.order_id) ?? 0 };
  });
  return { orders, excluded, reincluded };
}

// C7b : remise de COMMANDE (orders.discounts_amount) réinjectée dans les feuilles boutique et jour
// (ca_brut += remise, remises += remise ; ca_net inchangé), puis nœuds ré-évalués. Non mutant.
export function applyOrderDiscounts(result, orders = [], window = {}) {
  if (!result?.shop?.leaves) return result;
  const inWin = (d) => d != null && (!window.start || d >= window.start) && (!window.end || d <= window.end);
  let total = 0; const byDay = new Map();
  for (const o of orders) {
    if (o.excluded_reason) continue;
    const day = o.day_local ?? (o.created_at ? String(o.created_at).slice(0, 10) : null);
    if (!inWin(day)) continue;
    const d = round2(o.discounts_amount);
    if (!(d > 0)) continue;
    total += d; byDay.set(day, (byDay.get(day) ?? 0) + d);
  }
  if (!(total > 0)) return result;
  const bump = (entry, d) => {
    const leaves = { ...entry.leaves, ca_brut: round2(num(entry.leaves.ca_brut) + d), remises: round2(num(entry.leaves.remises) + d) };
    return { ...entry, leaves, nodes: evaluate(leaves) };
  };
  const out = { ...result, shop: bump(result.shop, total), byDay: { ...result.byDay } };
  for (const [day, d] of byDay) if (out.byDay[day]) out.byDay[day] = bump(out.byDay[day], d);
  out.shop.provisional_share = out.shop.nodes.ca_ht > 0 ? (num(out.shop.leaves.provisional_ca_ht) / out.shop.nodes.ca_ht) * 100 : null;
  return out;
}
