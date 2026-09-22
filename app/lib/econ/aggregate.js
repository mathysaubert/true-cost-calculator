// ── Agrégation à la LECTURE — PUR ─────────────────────────────────────────────────────────────
// Entrées = lignes déjà ingérées (snapshots figés par line.js + allocations) et faits externes ;
// sortie = feuilles du graphe par périmètre (boutique, jour, produit, canal, pays, code) + nœuds
// évalués + trous de données + modules (marketing, conversion, clients, retours, expédition, stock).
//
// Invariants repris de orderHistory.js (lot 7) : arrondi au centime PAR LIGNE avant sommation
// (Σ produits = total), devise unique (MIXED jamais sommé), lignes à coût manquant EXCLUES des
// marges et COMPTÉES à part (jamais 0), commandes distinctes.
// Conventions (rapport Phase 0 F3, à confirmer A16/A17) : remboursements nettés sur le JOUR DE LA
// COMMANDE (cohérent avec le snapshot par ligne) ; heures ouvrées = heures des jours lundi-vendredi
// dans le fuseau boutique.
import { evaluate } from "./nodes.js";
import { allocateOrderCosts } from "./allocate.js";
import { PLATFORM_UTM_SOURCES, DEFAULT_RETURN_WINDOW_DAYS, OVERSTOCK_DAYS } from "./config.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const DAY_MS = 86_400_000;
const dayOf = (iso) => (iso ? String(iso).slice(0, 10) : null);
const inWindow = (day, w) => day != null && (!w?.start || day >= w.start) && (!w?.end || day <= w.end);

// ── Coût de commande : port marchand (A3), emballage (A4), frais de paiement (A2 fait, d16) ─────
export function orderCosts({ order, fees = [], settings = {} }) {
  const gaps = [];
  // Frais de paiement : réels si présents, sinon règle par passerelle (« à confirmer »), sinon 0 + trou.
  let payment = 0, feesConfirmed = true;
  const real = fees.filter((f) => f.source === "shopify_payments");
  if (real.length) payment = real.reduce((s, f) => s + num(f.fee_amount), 0);
  else {
    const rules = Array.isArray(settings.gateway_fee_rules) ? settings.gateway_fee_rules : [];
    const gw = (order.gateway_names ?? [])[0];
    const rule = rules.find((r) => r.gateway === gw) ?? rules.find((r) => r.gateway === "*");
    if (rule) { payment = num(order.total_ttc) * num(rule.pct) / 100 + num(rule.fixed); feesConfirmed = rule.confirmed === true; }
    else feesConfirmed = false;
    if (!feesConfirmed) gaps.push("unconfirmed_fees");
  }
  // Port marchand : règle par pays, défaut, sinon « = port facturé au client » (A3b) non confirmé.
  const sr = settings.shipping_cost_rules ?? {};
  const byCountry = sr.byCountry ?? {};
  let shipping, shippingConfirmed = true;
  if (order.country_code && byCountry[order.country_code] != null) shipping = num(byCountry[order.country_code]);
  else if (sr.default != null) shipping = num(sr.default);
  else { shipping = num(order.shipping_charged); shippingConfirmed = false; gaps.push("unconfirmed_shipping"); }
  if (sr.confirmed === false) { shippingConfirmed = false; if (!gaps.includes("unconfirmed_shipping")) gaps.push("unconfirmed_shipping"); }
  const packaging = settings.packaging_cost_per_order == null ? 0 : num(settings.packaging_cost_per_order);
  if (settings.packaging_cost_per_order == null) gaps.push("no_packaging_cost");
  return { payment_fees: payment, shipping_cost: shipping, packaging_cost: packaging, feesConfirmed, shippingConfirmed, gaps };
}

// ── Coûts fixes sur une fenêtre : mensuel × jours couverts / jours du mois (A6, niveau boutique) ─
export function fixedCostsForWindow(fixedCosts = [], window = {}) {
  if (!window.start || !window.end) return null;
  let total = 0;
  for (let t = Date.parse(window.start + "T00:00:00Z"); t <= Date.parse(window.end + "T00:00:00Z"); t += DAY_MS) {
    const d = new Date(t);
    const day = d.toISOString().slice(0, 10);
    const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    for (const fc of fixedCosts) {
      if (fc.active_from && day < fc.active_from) continue;
      if (fc.active_to && day > fc.active_to) continue;
      total += num(fc.amount_monthly) / dim;
    }
  }
  return total;
}

// ── Commissions par code (A7) : chaque règle présente s'applique ; base = CA HT produits hors port ─
export function orderCommissions({ order, orderLines, codeRules = [] }) {
  const codes = (order.discount_codes ?? []).map((c) => String(c).trim().toUpperCase());
  if (!codes.length) return { amount: 0, partners: [] };
  const day = dayOf(order.created_at);
  const baseAfter = orderLines.reduce((s, l) => s + round2(l.unit_price_ht * l.revenue_units), 0);
  const baseBefore = orderLines.reduce((s, l) => s + round2((l.unit_price_original_ht ?? l.unit_price_ht) * l.revenue_units), 0);
  let amount = 0; const partners = [];
  for (const r of codeRules) {
    if (String(r.code).trim().toUpperCase() !== codes.find((c) => c === String(r.code).trim().toUpperCase())) continue;
    if (r.active_from && day < r.active_from) continue;
    if (r.active_to && day > r.active_to) continue;
    const base = r.commission_base === "ht_before_discount" ? baseBefore : baseAfter;
    amount += round2(base * num(r.commission_pct) / 100);
    if (r.partner_id) partners.push(r.partner_id);
  }
  return { amount, partners };
}

export function platformOfUtm(utmSource) {
  const s = String(utmSource ?? "").toLowerCase();
  for (const [platform, keys] of Object.entries(PLATFORM_UTM_SOURCES)) if (keys.some((k) => s.includes(k))) return platform;
  return null;
}

// ── Heures ouvrées lundi-vendredi dans un fuseau (convention A17) ─────────────────────────────
export function businessHoursBetween(startIso, endIso, timeZone = "UTC") {
  const a = Date.parse(startIso), b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  let hours = 0;
  const HOUR = 3_600_000;
  for (let t = a; t < b; t += HOUR) {
    const wd = fmt.format(new Date(t));
    if (wd !== "Sat" && wd !== "Sun") hours += Math.min(HOUR, b - t) / HOUR;
  }
  return hours;
}

const newBucket = () => ({
  orderIds: new Set(), knownOrderIds: new Set(), units: 0, new_customers: 0,
  ca_brut: 0, remises: 0, rembours: 0, taxes: 0, shipping_charged_ht: 0,
  known_ca_ht: 0, known_ca_ttc: 0, unknown_ca_ht: 0, unknown_cost_lines: 0,
  cogs: 0, shipping_cost: 0, packaging_cost: 0, payment_fees: 0, returns_cost: 0,
  ad_spend: 0, commissions: 0,
  attributed_ca_ttc: 0, attributed_cm2: 0, attributed_orders: 0, attributed_new_customers: 0, partner_new_customers: 0,
  first_orders_cm2: 0, first_orders_count: 0,
  provisional_orders: 0, provisional_ca_ht: 0, currencies: new Set(),
});
// Aucune ligne à coût connu dans le périmètre → les feuilles de marge sont NULL (pas 0) : CM1/CM2
// deviennent « inconnus », jamais un zéro silencieux (principe 5).
const finalize = (b) => { const k = b.knownOrderIds.size > 0; return ({
  orders: b.orderIds.size, known_orders: b.knownOrderIds.size, units: b.units, new_customers: b.new_customers,
  ca_brut: b.ca_brut, remises: b.remises, rembours: b.rembours, taxes: b.taxes, shipping_charged_ht: b.shipping_charged_ht,
  known_ca_ht: k ? b.known_ca_ht : null, known_ca_ttc: k ? b.known_ca_ttc : null, unknown_ca_ht: b.unknown_ca_ht, unknown_cost_lines: b.unknown_cost_lines,
  cogs: k ? b.cogs : null, shipping_cost: k ? b.shipping_cost : null, packaging_cost: k ? b.packaging_cost : null, payment_fees: k ? b.payment_fees : null, returns_cost: k ? b.returns_cost : null,
  ad_spend: b.ad_spend, commissions: b.commissions,
  attributed_ca_ttc: b.attributed_ca_ttc, attributed_cm2: b.attributed_cm2, attributed_orders: b.attributed_orders,
  attributed_new_customers: b.attributed_new_customers, partner_new_customers: b.partner_new_customers,
  first_orders_cm2: b.first_orders_cm2, first_orders_count: b.first_orders_count,
  provisional_orders: b.provisional_orders, provisional_ca_ht: b.provisional_ca_ht,
  currency: b.currencies.size === 1 ? [...b.currencies][0] : (b.currencies.size === 0 ? null : "MIXED"),
}); };

// ── Agrégation principale ──────────────────────────────────────────────────────────────────
// orders  : [{ order_id, created_at, day_local, excluded_reason, currency_code, customer_id,
//             customer_order_index, source_name, visit_source, utm_source, country_code,
//             discount_codes, shipping_charged, shipping_charged_ht, shipping_refunded, total_ttc,
//             gateway_names }]
// lines   : snapshots line.js + { order_id, cost_source } — une ligne 'excluded' (carte cadeau) est ignorée.
// fees    : [{ order_id, fee_amount, source, confirmed }]
// returns : [{ order_id, line_items: [{ line_item_id, quantity, return_reason }] }]
// fulfillments : [{ order_id, created_at, delivered_at, promised_at }]
// adSpend : [{ day_local, platform, spend_shop_currency, platform_revenue, platform_orders }]
// codeRules, manualCommissions [{ period_month, amount }], fixedCosts, sessions, inventory
// [{ variant_id, product_id, available, tracked, cost_per_unit, day_local }], variantCosts (Map)
// customers : [{ customer_id, cohort_month, first_order_at, second_order_at, orders_count, cm2_total }]
export function aggregate({
  orders = [], lines = [], fees = [], returns = [], fulfillments = [], adSpend = [], codeRules = [],
  manualCommissions = [], fixedCosts = [], sessions = [], inventory = [], variantCosts = new Map(),
  customers = [], settings = {}, window = {}, now = new Date(),
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const returnWindowDays = settings.return_window_days ?? DEFAULT_RETURN_WINDOW_DAYS;
  const shop = newBucket();
  const byDay = new Map(), byProduct = new Map(), byChannel = new Map(), byCountry = new Map(), byCode = new Map(), byPlatform = new Map();
  const bucket = (map, key) => { let b = map.get(key); if (!b) { b = newBucket(); map.set(key, b); } return b; };
  const gaps = { unconfirmed_fees: 0, unconfirmed_shipping: 0, no_packaging_cost: 0, unknown_cost_lines: 0, excluded_orders: 0 };

  const linesByOrder = new Map();
  for (const l of lines) { if (l.cost_source === "excluded" || l.is_gift_card) continue; const arr = linesByOrder.get(l.order_id) ?? []; arr.push(l); linesByOrder.set(l.order_id, arr); }
  const feesByOrder = new Map();
  for (const f of fees) { const arr = feesByOrder.get(f.order_id) ?? []; arr.push(f); feesByOrder.set(f.order_id, arr); }
  const ordersById = new Map();

  for (const o of orders) {
    if (o.excluded_reason) { gaps.excluded_orders++; continue; }
    const day = o.day_local ?? dayOf(o.created_at);
    if (!inWindow(day, window)) continue;
    ordersById.set(o.order_id, o);
    const ol = linesByOrder.get(o.order_id) ?? [];
    // CA de commande (produits) — arrondi par ligne.
    const enriched = ol.map((l) => {
      const ca_ht = round2(l.unit_price_ht * l.revenue_units);
      const ca_ttc = round2(l.unit_price_ttc * l.revenue_units);
      const known = l.cm1_unit != null && l.cost_source !== "missing";
      return { ...l, line_ca_ht: ca_ht, line_ca_ttc: ca_ttc, known, units: l.revenue_units };
    });
    const oc = orderCosts({ order: o, fees: feesByOrder.get(o.order_id) ?? [], settings });
    for (const g of oc.gaps) gaps[g] = (gaps[g] ?? 0) + 1;
    const alloc = allocateOrderCosts({ lines: enriched, costs: oc });
    const comm = orderCommissions({ order: o, orderLines: enriched, codeRules });
    const provisional = Number.isFinite(Date.parse(o.created_at)) && Date.parse(o.created_at) + returnWindowDays * DAY_MS > nowMs;
    const platform = platformOfUtm(o.utm_source);
    const isNew = o.customer_order_index === 1;
    const channel = o.visit_source || o.utm_source || o.source_name || "direct";
    const shippingHt = o.shipping_charged_ht != null ? num(o.shipping_charged_ht) : num(o.shipping_charged) - num(o.shipping_refunded);
    let orderCm2Known = 0, orderKnown = false;

    const targets = [shop, bucket(byDay, day), bucket(byChannel, channel), bucket(byCountry, o.country_code ?? "??")];
    if (platform) targets.push(bucket(byPlatform, platform));
    for (const c of o.discount_codes ?? []) targets.push(bucket(byCode, String(c).toUpperCase()));
    for (const l of enriched) {
      const a = alloc.get(l.line_item_id) ?? { payment: 0, shipping: 0, packaging: 0 };
      const cogs = l.known ? round2(l.cout_rendu_unit * l.cogs_units) : 0;
      const lineCm2 = l.known ? l.line_ca_ht - cogs - round2(a.shipping) - round2(a.packaging) - round2(a.payment) : null;
      const brut = round2((l.unit_price_original_ht != null ? l.unit_price_original_ht + l.tax_per_unit : l.unit_price_ttc) * l.quantity);
      const remise = round2(brut - round2(l.unit_price_ttc * l.quantity));
      const remb = round2(l.unit_price_ttc * l.refunded_qty);
      const tax = round2(l.tax_per_unit * l.revenue_units);
      const apply = (b) => {
        b.units += l.revenue_units; b.ca_brut += brut; b.remises += remise; b.rembours += remb; b.taxes += tax;
        if (l.currency_code ?? o.currency_code) b.currencies.add(l.currency_code ?? o.currency_code);
        if (l.known) {
          b.known_ca_ht += l.line_ca_ht; b.known_ca_ttc += l.line_ca_ttc; b.cogs += cogs;
          b.shipping_cost += round2(a.shipping); b.packaging_cost += round2(a.packaging); b.payment_fees += round2(a.payment);
          b.knownOrderIds.add(o.order_id);
        } else { b.unknown_ca_ht += l.line_ca_ht; b.unknown_cost_lines++; }
      };
      for (const b of targets) apply(b);
      const pb = bucket(byProduct, l.product_id ?? "__unknown__"); apply(pb); pb.orderIds.add(o.order_id);
      if (provisional) { pb.provisional_ca_ht += l.line_ca_ht; }
      if (l.known) { orderCm2Known += lineCm2; orderKnown = true; }
      if (!l.known) gaps.unknown_cost_lines++;
    }
    const orderCaHt = enriched.reduce((s, l) => s + l.line_ca_ht, 0);
    const orderCaTtc = enriched.reduce((s, l) => s + l.line_ca_ttc, 0) + num(o.shipping_charged) - num(o.shipping_refunded);
    for (const b of targets) {
      b.orderIds.add(o.order_id);
      b.shipping_charged_ht += round2(shippingHt); b.ca_brut += num(o.shipping_charged); b.rembours += num(o.shipping_refunded);
      b.taxes += round2(num(o.shipping_charged) - num(o.shipping_refunded) - shippingHt);
      if (isNew) b.new_customers++;
      b.commissions += comm.amount;
      if (comm.partners.length && isNew) b.partner_new_customers++;
      if (provisional) { b.provisional_orders++; b.provisional_ca_ht += orderCaHt; }
      if (platform) { b.attributed_ca_ttc += orderCaTtc; b.attributed_orders++; if (isNew) b.attributed_new_customers++; if (orderKnown) b.attributed_cm2 += orderCm2Known; }
      if (isNew && orderKnown) { b.first_orders_cm2 += orderCm2Known; b.first_orders_count++; }
    }
  }

  // Frais de retour saisis (brief §7, CM2) : return_cost_per_return × retours d'une commande de la
  // fenêtre — boutique, jour de la commande, produits des lignes retournées (part égale). Comme les
  // autres coûts de commande, seulement si la commande a au moins une ligne à coût connu.
  const perReturn = settings.return_cost_per_return == null ? 0 : num(settings.return_cost_per_return);
  if (perReturn > 0) {
    for (const r of returns) {
      const o = ordersById.get(r.order_id); if (!o) continue;
      const ol = (linesByOrder.get(o.order_id) ?? []).filter((l) => l.cm1_unit != null && l.cost_source !== "missing");
      if (!ol.length) continue;
      const day = o.day_local ?? dayOf(o.created_at);
      shop.returns_cost += perReturn; bucket(byDay, day).returns_cost += perReturn;
      const prods = [...new Set((r.line_items ?? []).map((li) => ol.find((l) => l.line_item_id === li.line_item_id)?.product_id).filter(Boolean))];
      for (const p of prods) bucket(byProduct, p).returns_cost += perReturn / prods.length;
    }
  }

  // Dépenses pub (fenêtre) — boutique, jour, plateforme.
  for (const a of adSpend) {
    if (!inWindow(a.day_local, window)) continue;
    const spend = num(a.spend_shop_currency ?? a.spend);
    shop.ad_spend += spend; bucket(byDay, a.day_local).ad_spend += spend; bucket(byPlatform, a.platform).ad_spend += spend;
  }
  // Commissions manuelles (période mensuelle, prorata des jours couverts par la fenêtre).
  for (const m of manualCommissions) {
    const fc = fixedCostsForWindow([{ amount_monthly: m.amount, active_from: `${m.period_month}-01`, active_to: `${m.period_month}-31` }], window) ?? 0;
    shop.commissions += fc;
  }
  const fixed = fixedCostsForWindow(fixedCosts, window);

  const leaves = (b, extra = {}) => ({ ...finalize(b), fixed_costs: extra.fixed ?? null, target_margin_after_ads_pct: settings.target_margin_after_ads_pct ?? null, main_product_price: settings.main_product_price ?? null, ...extra });
  const sessionsTotals = sessions.filter((s) => inWindow(s.day_local, window)).reduce((t, s) => ({ sessions: t.sessions + num(s.sessions), atc_sessions: t.atc_sessions + num(s.atc_sessions), checkout_sessions: t.checkout_sessions + num(s.checkout_sessions), purchase_sessions: t.purchase_sessions + num(s.purchase_sessions) }), { sessions: 0, atc_sessions: 0, checkout_sessions: 0, purchase_sessions: 0 });
  const shopLeaves = leaves(shop, { fixed, ...sessionsTotals });
  const shopNodes = evaluate(shopLeaves);
  const mapOut = (map, extra) => Object.fromEntries([...map.entries()].map(([k, b]) => { const lv = leaves(b, extra?.(k, b)); return [k, { leaves: lv, nodes: evaluate(lv) }]; }));

  // Modules complémentaires (10.7 → 10.11) ------------------------------------------------------
  const conversion = { ...sessionsTotals, bySource: {}, byDevice: {} };
  for (const s of sessions) {
    if (!inWindow(s.day_local, window)) continue;
    for (const [key, dim] of [["bySource", s.source ?? ""], ["byDevice", s.device ?? ""]]) {
      const t = conversion[key][dim] ?? { sessions: 0, atc_sessions: 0, checkout_sessions: 0, purchase_sessions: 0 };
      t.sessions += num(s.sessions); t.atc_sessions += num(s.atc_sessions); t.checkout_sessions += num(s.checkout_sessions); t.purchase_sessions += num(s.purchase_sessions);
      conversion[key][dim] = t;
    }
  }
  for (const key of ["bySource", "byDevice"]) for (const dim of Object.keys(conversion[key])) conversion[key][dim] = { ...conversion[key][dim], nodes: evaluate(conversion[key][dim]) };

  // Retours : commandes retournées / commandes ; CA remboursé / CA ; motifs ; base = commandes SORTIES du délai.
  const returnedOrders = new Set(returns.filter((r) => ordersById.has(r.order_id)).map((r) => r.order_id));
  const reasons = {};
  for (const r of returns) { if (!ordersById.has(r.order_id)) continue; for (const li of r.line_items ?? []) { const k = li.return_reason ?? "UNKNOWN"; reasons[k] = (reasons[k] ?? 0) + num(li.quantity); } }
  const ordersOutOfWindow = [...ordersById.values()].filter((o) => Date.parse(o.created_at) + returnWindowDays * DAY_MS <= nowMs);
  const refundedOrders = new Set(lines.filter((l) => ordersById.has(l.order_id) && l.refunded_qty > 0).map((l) => l.order_id));
  const returnsModule = {
    orders_out_of_window: ordersOutOfWindow.length,
    return_rate: ordersOutOfWindow.length ? (ordersOutOfWindow.filter((o) => returnedOrders.has(o.order_id) || refundedOrders.has(o.order_id)).length / ordersOutOfWindow.length) * 100 : null,
    refund_rate: shopLeaves.ca_brut > 0 ? (shopLeaves.rembours / shopLeaves.ca_brut) * 100 : null,
    returns_cost: shopLeaves.returns_cost, reasons,
    reason_shares: Object.fromEntries(Object.entries(reasons).map(([k, q]) => [k, Object.values(reasons).reduce((s, x) => s + x, 0) > 0 ? (q / Object.values(reasons).reduce((s, x) => s + x, 0)) * 100 : null])),
  };

  // Expédition : délai commande → expédition (heures ouvrées), OTD, retards.
  const tz = settings.shop_timezone ?? "UTC";
  const shipStats = { shipped: 0, delay_hours_sum: 0, delivered: 0, on_time: 0, delivery_days_sum: 0 };
  for (const f of fulfillments) {
    const o = ordersById.get(f.order_id); if (!o) continue;
    shipStats.shipped++; shipStats.delay_hours_sum += businessHoursBetween(o.created_at, f.created_at, tz);
    if (f.delivered_at) {
      shipStats.delivered++; shipStats.delivery_days_sum += (Date.parse(f.delivered_at) - Date.parse(f.created_at)) / DAY_MS;
      const promised = f.promised_at ?? (settings.delivery_promise_days != null ? new Date(Date.parse(o.created_at) + settings.delivery_promise_days * DAY_MS).toISOString() : null);
      if (promised && Date.parse(f.delivered_at) <= Date.parse(promised)) shipStats.on_time++;
    }
  }
  const shipping = {
    shipped: shipStats.shipped, ship_delay_hours: shipStats.shipped ? shipStats.delay_hours_sum / shipStats.shipped : null,
    delivered: shipStats.delivered, delivery_days: shipStats.delivered ? shipStats.delivery_days_sum / shipStats.delivered : null,
    otd: shipStats.delivered ? (shipStats.on_time / shipStats.delivered) * 100 : null,
    late_share: shipStats.delivered ? ((shipStats.delivered - shipStats.on_time) / shipStats.delivered) * 100 : null,
    shipping_cost_per_order: shopLeaves.orders ? shopLeaves.shipping_cost / shopLeaves.orders : null,
  };

  // Stock (10.11) : dernier instantané par variante, ventes/jour sur la fenêtre, point de commande.
  const windowDays = window.start && window.end ? Math.round((Date.parse(window.end) - Date.parse(window.start)) / DAY_MS) + 1 : null;
  const latestInv = new Map(); const stockoutDays = new Map();
  for (const i of inventory) {
    const cur = latestInv.get(i.variant_id);
    if (!cur || i.day_local > cur.day_local) latestInv.set(i.variant_id, i);
    if (inWindow(i.day_local, window) && i.tracked !== false && num(i.available) <= 0) stockoutDays.set(i.variant_id, (stockoutDays.get(i.variant_id) ?? 0) + 1);
  }
  const unitsByVariant = new Map(), revenueByVariant = new Map();
  for (const l of lines) { if (!ordersById.has(l.order_id) || !l.variant_id) continue; unitsByVariant.set(l.variant_id, (unitsByVariant.get(l.variant_id) ?? 0) + l.revenue_units); revenueByVariant.set(l.variant_id, (revenueByVariant.get(l.variant_id) ?? 0) + round2(l.unit_price_ht * l.revenue_units)); }
  const stock = { tracked: false, byVariant: {}, cash_immobilized: 0, dormant: [], overstock: [], reorder_now: [] };
  for (const [vid, inv] of latestInv) {
    if (inv.tracked === false) continue;
    stock.tracked = true;
    const units = unitsByVariant.get(vid) ?? 0;
    const salesPerDay = windowDays ? units / windowDays : null;
    const vc = variantCosts.get?.(vid) ?? {};
    const lead = num(vc.supplier_lead_days), buffer = num(vc.buffer_days);
    const coverage = salesPerDay > 0 ? num(inv.available) / salesPerDay : null;
    const reorderPoint = salesPerDay != null ? salesPerDay * (lead + buffer) : null;
    const avgPrice = units > 0 ? (revenueByVariant.get(vid) ?? 0) / units : null;
    const so = stockoutDays.get(vid) ?? 0;
    const row = {
      variant_id: vid, product_id: inv.product_id ?? null, available: num(inv.available), sales_per_day: salesPerDay,
      coverage_days: coverage, reorder_point: reorderPoint, reorder_now: reorderPoint != null && num(inv.available) <= reorderPoint && salesPerDay > 0,
      stockout_days: so, lost_revenue: salesPerDay != null && avgPrice != null ? salesPerDay * so * avgPrice : null,
      rotation: windowDays && num(inv.available) > 0 && salesPerDay != null ? (salesPerDay * windowDays) / num(inv.available) : null,
      dormant: units === 0 && num(inv.available) > 0, overstock: coverage != null && coverage > OVERSTOCK_DAYS,
      cash_immobilized: num(inv.available) * num(inv.cost_per_unit ?? vc.prix_achat),
    };
    stock.byVariant[vid] = row; stock.cash_immobilized += row.cash_immobilized;
    if (row.dormant) stock.dormant.push(vid); if (row.overstock) stock.overstock.push(vid); if (row.reorder_now) stock.reorder_now.push(vid);
  }

  // Clients (10.8) : cohortes mensuelles, rachat M+k, fréquence, délai 2e achat, LTV CM2.
  const cohorts = {};
  const monthsBetween = (a, b) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  for (const c of customers) {
    const key = c.cohort_month ?? dayOf(c.first_order_at)?.slice(0, 7); if (!key) continue;
    const co = cohorts[key] ?? { cohort_month: key, customers: 0, orders: 0, repeat: { 1: 0, 3: 0, 6: 0, 12: 0 }, days_to_second_sum: 0, second_count: 0, cm2_total: 0, cm2_known: 0, age_months: monthsBetween(new Date(key + "-01T00:00:00Z"), new Date(nowMs)) };
    co.customers++; co.orders += num(c.orders_count);
    if (c.second_order_at) {
      const gap = (Date.parse(c.second_order_at) - Date.parse(c.first_order_at)) / DAY_MS;
      co.days_to_second_sum += gap; co.second_count++;
      for (const k of [1, 3, 6, 12]) if (gap <= k * 30.44) co.repeat[k]++;
    }
    if (c.cm2_total != null) { co.cm2_total += num(c.cm2_total); co.cm2_known++; }
    cohorts[key] = co;
  }
  for (const co of Object.values(cohorts)) {
    co.repeat_rate = Object.fromEntries([1, 3, 6, 12].map((k) => [k, co.age_months >= k && co.customers ? (co.repeat[k] / co.customers) * 100 : null]));
    co.frequency = co.customers ? co.orders / co.customers : null;
    co.days_to_second = co.second_count ? co.days_to_second_sum / co.second_count : null;
    co.ltv_cm2 = co.cm2_known ? co.cm2_total / co.cm2_known : null;
  }
  const allCustomers = customers.length;
  const ltvKnown = customers.filter((c) => c.cm2_total != null);
  const ltv = ltvKnown.length ? ltvKnown.reduce((s, c) => s + num(c.cm2_total), 0) / ltvKnown.length : null;
  const monthsSpan = window.start && window.end ? Math.max(1, monthsBetween(new Date(window.start + "T00:00:00Z"), new Date(window.end + "T00:00:00Z")) + 1) : null;
  const monthlyContributionPerCustomer = ltv != null && monthsSpan ? ltv / monthsSpan : null;
  const customersModule = { customers: allCustomers, cohorts, ltv_cm2: ltv, ltv_cac: ltv != null && shopNodes.cac_global > 0 ? ltv / shopNodes.cac_global : null, monthly_contribution_per_customer: monthlyContributionPerCustomer };

  const marketing = { byPlatform: {} };
  for (const [p, b] of byPlatform) {
    const spendRows = adSpend.filter((a) => a.platform === p && inWindow(a.day_local, window));
    const lv = leaves(b);
    marketing.byPlatform[p] = { leaves: lv, nodes: evaluate(lv), platform_revenue: spendRows.reduce((s, a) => s + num(a.platform_revenue), 0), platform_orders: spendRows.reduce((s, a) => s + num(a.platform_orders), 0) };
    const pr = marketing.byPlatform[p];
    pr.roas_platform = pr.leaves.ad_spend > 0 ? pr.platform_revenue / pr.leaves.ad_spend : null;
    // Levier prudent (brief §7) : le plus bas des deux ROAS.
    pr.roas_conservative = pr.roas_platform == null ? pr.nodes.roas_utm : (pr.nodes.roas_utm == null ? pr.roas_platform : Math.min(pr.roas_platform, pr.nodes.roas_utm));
  }
  const channelOut = mapOut(byChannel);
  const concentration = shopLeaves.ca_ht > 0 ? Object.fromEntries(Object.entries(channelOut).map(([k, v]) => [k, (v.leaves.ca_ht ?? v.nodes.ca_ht ?? 0) / shopLeaves.ca_ht * 100])) : {};

  return {
    window, currency: shopLeaves.currency,
    shop: { leaves: shopLeaves, nodes: shopNodes, provisional_share: shopNodes.ca_ht > 0 ? (shopLeaves.provisional_ca_ht / shopNodes.ca_ht) * 100 : null },
    byDay: mapOut(byDay), byProduct: mapOut(byProduct), byChannel: channelOut, byCountry: mapOut(byCountry), byCode: mapOut(byCode),
    marketing: { ...marketing, concentration }, conversion, returns: returnsModule, shipping, stock, customers: customersModule,
    dataGaps: gaps,
    counts: { orders: shopLeaves.orders, known_orders: shopLeaves.known_orders, sessions: sessionsTotals.sessions, checkout_sessions: sessionsTotals.checkout_sessions, first_orders: shopLeaves.first_orders_count, attributed_orders: shopLeaves.attributed_orders, customers: allCustomers, orders_out_of_window: returnsModule.orders_out_of_window, delivered: shipStats.delivered, shipped: shipStats.shipped, sales_days: windowDays ?? 0, months: monthsSpan ?? 0 },
  };
}
