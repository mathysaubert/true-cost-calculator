// ── Sync v2 (F2) — NORMALISEUR UNIQUE, PUR (aucun I/O, aucun React) ─────────────────────────
// Deux adaptateurs produisent la MÊME forme interne « OrderFacts » : fromWebhookPayload (JSON du
// webhook, clés snake_case, ids numériques) et fromGraphqlNode (nœud bulk re-stitché ou requête,
// clés camelCase, gids). Le lot 25 prouve l'égalité des deux formes sur une même commande.
// Puis normalizeOrder fige la commande : ligne `orders` + lignes `order_margins` (colonnes legacy
// via buildHistoryRow — B7 double écriture — ET colonnes F1 via computeLineEconomics — F3).
// Aucune formule de marge ici : tout vient de econ/ (F3) et d'orderIngest.js (legacy).
// Données protégées : seuls customer.id et le code pays sont lus ; un champ vide (non approuvé,
// invité) donne null, jamais une erreur.
import { computeLineEconomics } from "../econ/line.js";
import { orderCosts } from "../econ/aggregate.js";
import { allocateOrderCosts } from "../econ/allocate.js";
import { buildHistoryRow, allocateOrderFixedFee } from "../orderIngest.js";

export const BREAKDOWN_VERSION = 2;
const DAY_MS = 86_400_000;
// restock_type (webhook, minuscules) / restockType (GraphQL, majuscules) → unités RESTOCKÉES (A2).
export const RESTOCKED_TYPES = new Set(["return", "cancel", "legacy_restock"]);

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const intPos = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const up = (v) => (v == null ? null : String(v).toUpperCase());
const low = (v) => (v == null ? null : String(v).toLowerCase());
// Montant depuis un MoneyBag (shopMoney / shop_money — JAMAIS presentment, D1) ou une valeur brute.
export const amt = (v) => {
  if (v == null) return null;
  if (typeof v === "object") {
    const a = v.shopMoney?.amount ?? v.shop_money?.amount ?? v.amount;
    if (a == null) return null;
    const n = parseFloat(a); return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(v); return Number.isFinite(n) ? n : null;
};
export function gid(kind, v) {
  if (v == null || v === "") return null;
  const s = String(v);
  return s.startsWith("gid://") ? s : `gid://shopify/${kind}/${s}`;
}
// Connexion GraphQL (edges/nodes) OU tableau déjà re-stitché par parseBulkJsonl → tableau.
export const nodes = (x) => (Array.isArray(x) ? x : Array.isArray(x?.nodes) ? x.nodes : (x?.edges ?? []).map((e) => e.node));

// ── Jour local dans le fuseau boutique (figé à l'ingestion, décision e / B14) ─────────────────
export function dayLocal(iso, timeZone) {
  const d = new Date(iso ?? NaN);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch { return d.toISOString().slice(0, 10); }
}
const weekdayIn = (ms, timeZone) => {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: timeZone || "UTC", weekday: "short" }).format(new Date(ms)); }
  catch { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(new Date(ms)); }
};
// Promesse de livraison : commande + N jours OUVRÉS lundi-vendredi dans le fuseau boutique (décision 15, A17).
export function promisedAt(createdIso, promiseDays, timeZone) {
  if (promiseDays == null) return null;
  let t = Date.parse(createdIso ?? "");
  if (!Number.isFinite(t)) return null;
  let remaining = intPos(promiseDays, 0);
  while (remaining > 0) {
    t += DAY_MS;
    const wd = weekdayIn(t, timeZone);
    if (wd !== "Sat" && wd !== "Sun") remaining--;
  }
  return new Date(t).toISOString();
}

// ── Remboursements ────────────────────────────────────────────────────────────────────────────
const settledOf = (transactions) => transactions.some((t) => t.kind === "REFUND" && t.status === "SUCCESS");
export function refundFromWebhook(p, { timeZone } = {}) {
  const transactions = (p?.transactions ?? []).map((t) => ({ kind: up(t.kind), status: up(t.status), amount: num(t.amount) }));
  const settled = settledOf(transactions);
  const createdAt = p?.created_at ?? p?.processed_at ?? null;
  return {
    refund_id: gid("Refund", p?.admin_graphql_api_id ?? p?.id),
    order_id: gid("Order", p?.order_id),
    created_at: createdAt,
    day_local: dayLocal(createdAt, timeZone),
    total_refunded: round2(transactions.filter((t) => t.kind === "REFUND" && t.status === "SUCCESS").reduce((s, t) => s + t.amount, 0)),
    shipping_refunded: round2((p?.refund_shipping_lines ?? []).reduce((s, l) => s + (amt(l.subtotal_amount_set) ?? 0), 0)),
    line_items: (p?.refund_line_items ?? []).map((li) => ({
      line_item_id: gid("LineItem", li.line_item?.admin_graphql_api_id ?? li.line_item_id ?? li.line_item?.id),
      quantity: intPos(li.quantity, 0),
      subtotal: amt(li.subtotal_set) ?? num(li.subtotal),
      restock_type: low(li.restock_type) ?? "no_restock",
    })),
    transactions,
    settled,
    detailed: true,
  };
}
export function refundFromGraphql(r, orderId, { timeZone } = {}) {
  const transactions = nodes(r?.transactions).map((t) => ({ kind: up(t.kind), status: up(t.status), amount: amt(t.amountSet) ?? 0 }));
  const lineItems = nodes(r?.refundLineItems);
  const detailed = r?.refundLineItems != null || r?.transactions != null;
  return {
    refund_id: r?.id ?? null,
    order_id: orderId ?? r?.order?.id ?? null,
    created_at: r?.createdAt ?? null,
    day_local: dayLocal(r?.createdAt, timeZone),
    total_refunded: round2(amt(r?.totalRefundedSet) ?? 0),
    shipping_refunded: round2(nodes(r?.refundShippingLines).reduce((s, l) => s + (amt(l.subtotalAmountSet) ?? 0), 0)),
    line_items: lineItems.map((li) => ({
      line_item_id: li.lineItem?.id ?? null,
      quantity: intPos(li.quantity, 0),
      subtotal: amt(li.subtotalSet),
      restock_type: low(li.restockType) ?? "no_restock",
    })),
    transactions,
    settled: settledOf(transactions),
    detailed,
  };
}
// Quantités par ligne depuis les remboursements RÉGLÉS (D4) : remboursées, et restockées si l'info
// existe (A2). Dédoublonné par refund_id (webhook + requête peuvent livrer le même remboursement).
export function refundedQuantities(refundRows = []) {
  const seen = new Set(); const out = new Map();
  for (const r of refundRows) {
    if (!r || !r.settled) continue;
    if (r.refund_id) { if (seen.has(r.refund_id)) continue; seen.add(r.refund_id); }
    for (const li of r.line_items ?? []) {
      if (!li?.line_item_id) continue;
      const e = out.get(li.line_item_id) ?? { refunded_qty: 0, restocked_qty: 0, restock_known: false };
      const q = intPos(li.quantity, 0);
      e.refunded_qty += q;
      if (li.restock_type != null) { e.restock_known = true; if (RESTOCKED_TYPES.has(String(li.restock_type).toLowerCase())) e.restocked_qty += q; }
      out.set(li.line_item_id, e);
    }
  }
  for (const e of out.values()) if (!e.restock_known) e.restocked_qty = null;
  return out;
}

// ── Retours (scope read_returns ; webhooks GraphQL-only, statuts en minuscules) ───────────────
export function returnFromWebhook(p, { timeZone, now = new Date() } = {}) {
  const status = up(p?.status);
  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  const items = (p?.return_line_items ?? []).map((li) => ({
    line_item_id: gid("LineItem", li.fulfillment_line_item?.line_item?.admin_graphql_api_id ?? li.fulfillment_line_item?.line_item?.id),
    quantity: intPos(li.quantity, 0),
    return_reason: up(li.return_reason),
    note: li.return_reason_note ?? null,
  }));
  return {
    return_id: gid("Return", p?.admin_graphql_api_id ?? p?.id),
    order_id: gid("Order", p?.order?.admin_graphql_api_id ?? p?.order?.id ?? p?.order_id),
    status,
    requested_at: status === "REQUESTED" ? nowIso : null,
    closed_at: status === "CLOSED" ? nowIso : null,
    day_local: dayLocal(nowIso, timeZone),
    line_items: items,
    partial: intPos(p?.total_return_line_items, 0) > items.length,
  };
}
export function returnFromGraphql(r, orderId, { timeZone } = {}) {
  const created = r?.createdAt ?? null;
  return {
    return_id: r?.id ?? null,
    order_id: orderId ?? null,
    status: up(r?.status),
    requested_at: created,
    closed_at: r?.closedAt ?? null,
    day_local: dayLocal(created, timeZone),
    line_items: nodes(r?.returnLineItems).map((li) => ({
      line_item_id: li.fulfillmentLineItem?.lineItem?.id ?? null,
      quantity: intPos(li.quantity, 0),
      return_reason: up(li.returnReason),
      note: li.returnReasonNote ?? null,
    })),
    partial: false,
  };
}

// ── Expéditions ──────────────────────────────────────────────────────────────────────────────
export function fulfillmentFromWebhook(p, { timeZone } = {}) {
  const shipment = low(p?.shipment_status);
  const created = p?.created_at ?? null;
  return {
    fulfillment_id: gid("Fulfillment", p?.admin_graphql_api_id ?? p?.id),
    order_id: gid("Order", p?.order_id),
    created_at: created,
    status: up(p?.status),
    tracking_company: p?.tracking_company ?? null,
    tracking_numbers: (p?.tracking_numbers ?? (p?.tracking_number ? [p.tracking_number] : [])).filter(Boolean).map(String),
    delivered_at: shipment === "delivered" ? (p?.updated_at ?? created) : null,
    last_event_status: up(shipment),
    last_event_at: shipment ? (p?.updated_at ?? null) : null,
    estimated_delivery_at: p?.estimated_delivery_at ?? null,
    country_code: p?.destination?.country_code ?? null,
    day_local: dayLocal(created, timeZone),
  };
}
export function fulfillmentFromGraphql(f, order, { timeZone } = {}) {
  const tracking = f?.trackingInfo ?? [];
  return {
    fulfillment_id: f?.id ?? null,
    order_id: order?.order_id ?? order?.id ?? null,
    created_at: f?.createdAt ?? null,
    status: up(f?.status),
    tracking_company: tracking[0]?.company ?? null,
    tracking_numbers: tracking.map((t) => t.number).filter(Boolean).map(String),
    delivered_at: f?.deliveredAt ?? null,
    last_event_status: up(f?.displayStatus),
    last_event_at: f?.deliveredAt ?? f?.inTransitAt ?? null,
    estimated_delivery_at: f?.estimatedDeliveryAt ?? null,
    country_code: order?.country_code ?? null,
    day_local: dayLocal(f?.createdAt, timeZone),
  };
}
// fulfillment_events/create → correctif appliqué à la ligne fulfillments (DELIVERED fixe delivered_at).
export function fulfillmentEventPatch(p) {
  const status = up(p?.status);
  return {
    fulfillment_id: gid("Fulfillment", p?.fulfillment_id),
    order_id: gid("Order", p?.order_id),
    status,
    happened_at: p?.happened_at ?? p?.created_at ?? null,
    estimated_delivery_at: p?.estimated_delivery_at ?? null,
    delivered: status === "DELIVERED",
  };
}

// ── OrderFacts : adaptateur WEBHOOK (JSON REST-like, ids numériques) ─────────────────────────
export function fromWebhookPayload(p = {}) {
  const lines = (p.line_items ?? []).map((li) => {
    const qty = intPos(li.quantity, 0);
    const original = amt(li.price_set) ?? amt(li.price) ?? 0;
    const alloc = (li.discount_allocations ?? []).reduce((s, a) => s + (amt(a.amount_set) ?? amt(a.amount) ?? 0), 0);
    return {
      line_item_id: gid("LineItem", li.admin_graphql_api_id ?? li.id),
      product_id: li.product_id != null ? gid("Product", li.product_id) : null,
      variant_id: li.variant_id != null ? gid("ProductVariant", li.variant_id) : null,
      quantity: qty,
      is_gift_card: li.gift_card === true,
      unit_price: round2(original - alloc / (qty || 1)),
      unit_price_original: round2(original),
      tax_lines: (li.tax_lines ?? []).map((t) => ({ title: t.title ?? null, rate: t.rate ?? null, amount: round2(amt(t.price_set) ?? amt(t.price) ?? 0) })),
    };
  });
  const shippingTax = (p.shipping_lines ?? []).reduce((s, sl) => s + (sl.tax_lines ?? []).reduce((t, x) => t + (amt(x.price_set) ?? amt(x.price) ?? 0), 0), 0);
  const tags = typeof p.tags === "string" ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : (p.tags ?? []);
  return {
    source: "webhook",
    order_id: gid("Order", p.admin_graphql_api_id ?? p.id),
    order_name: p.name ?? null,
    created_at: p.created_at ?? null,
    processed_at: p.processed_at ?? null,
    cancelled_at: p.cancelled_at ?? null,
    is_test: p.test === true,
    source_name: p.source_name ?? null,
    gateway_names: (p.payment_gateway_names ?? []).filter(Boolean),
    purchasing_company_id: p.company?.id != null ? gid("Company", p.company.id) : null,
    is_b2b_entity: p.company != null,
    tags,
    customer_id: p.customer?.id != null ? gid("Customer", p.customer.id) : null,
    customer_order_index: null,
    currency_code: p.currency ?? null,
    taxes_included: p.taxes_included === true,
    subtotal_ttc: amt(p.subtotal_price_set) ?? amt(p.subtotal_price),
    discounts_amount: round2(amt(p.total_discounts_set) ?? amt(p.total_discounts) ?? 0),
    discount_codes: (p.discount_codes ?? []).map((c) => (typeof c === "string" ? c : c?.code)).filter(Boolean).map((c) => String(c).trim()),
    shipping_charged: round2(amt(p.total_shipping_price_set) ?? 0),
    shipping_tax: round2(shippingTax),
    tax_amount: round2(amt(p.total_tax_set) ?? amt(p.total_tax) ?? 0),
    total_ttc: amt(p.total_price_set) ?? amt(p.total_price),
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, utm_term: null,
    visit_source: null, visit_source_type: null, landing_page: null,
    attribution_ready: false,
    country_code: p.shipping_address?.country_code ?? null,
    lines,
    refunds: (p.refunds ?? []).map((r) => refundFromWebhook({ ...r, order_id: r.order_id ?? p.id })),
    fulfillments: (p.fulfillments ?? []).map((f) => fulfillmentFromWebhook({ ...f, order_id: f.order_id ?? p.id })),
  };
}

// ── OrderFacts : adaptateur GRAPHQL (nœud bulk re-stitché ou réponse paginée) ────────────────
export function fromGraphqlNode(n = {}) {
  const lines = nodes(n.lineItems).map((li) => {
    const qty = intPos(li.quantity, 0);
    const original = amt(li.originalUnitPriceSet) ?? 0;
    let unit = amt(li.discountedUnitPriceAfterAllDiscountsSet);
    if (unit == null) { // D1 : repli SSI le champ AfterAll est absent
      const alloc = (li.discountAllocations ?? []).reduce((s, a) => s + (amt(a.allocatedAmountSet) ?? 0), 0);
      unit = original - alloc / (qty || 1);
    }
    return {
      line_item_id: li.id ?? null,
      product_id: li.product?.id ?? null,
      variant_id: li.variant?.id ?? null,
      quantity: qty,
      is_gift_card: li.isGiftCard === true,
      unit_price: round2(unit),
      unit_price_original: round2(original),
      tax_lines: (li.taxLines ?? []).map((t) => ({ title: t.title ?? null, rate: t.rate ?? null, amount: round2(amt(t.priceSet) ?? 0) })),
    };
  });
  const shippingTax = nodes(n.shippingLines).reduce((s, sl) => s + (sl.taxLines ?? []).reduce((t, x) => t + (amt(x.priceSet) ?? 0), 0), 0);
  const j = n.customerJourneySummary ?? null;
  const v = j?.lastVisit ?? null;
  const utm = v?.utmParameters ?? null;
  return {
    source: "graphql",
    order_id: n.id ?? null,
    order_name: n.name ?? null,
    created_at: n.createdAt ?? null,
    processed_at: n.processedAt ?? null,
    cancelled_at: n.cancelledAt ?? null,
    is_test: n.test === true,
    source_name: n.sourceName ?? null,
    gateway_names: (n.paymentGatewayNames ?? []).filter(Boolean),
    purchasing_company_id: n.purchasingEntity?.company?.id ?? null,
    is_b2b_entity: n.purchasingEntity?.__typename === "PurchasingCompany",
    tags: Array.isArray(n.tags) ? n.tags : [],
    customer_id: n.customer?.id ?? null,
    customer_order_index: j?.customerOrderIndex ?? null,
    currency_code: n.currencyCode ?? null,
    taxes_included: n.taxesIncluded === true,
    subtotal_ttc: amt(n.subtotalPriceSet),
    discounts_amount: round2(amt(n.totalDiscountsSet) ?? 0),
    discount_codes: (n.discountCodes ?? []).filter(Boolean).map((c) => String(c).trim()),
    shipping_charged: round2(amt(n.totalShippingPriceSet) ?? 0),
    shipping_tax: round2(shippingTax),
    tax_amount: round2(amt(n.totalTaxSet) ?? 0),
    total_ttc: amt(n.totalPriceSet),
    utm_source: utm?.source ?? null, utm_medium: utm?.medium ?? null, utm_campaign: utm?.campaign ?? null,
    utm_content: utm?.content ?? null, utm_term: utm?.term ?? null,
    visit_source: v?.source ?? null, visit_source_type: v?.sourceType ?? null, landing_page: v?.landingPage ?? null,
    attribution_ready: j?.ready === true,
    country_code: n.shippingAddress?.countryCodeV2 ?? null,
    lines,
    // En-têtes seulement dans le bulk (refundLineItems est une connexion sous liste, interdite) :
    // detailed=false → jamais écrits en base, le détail vient de la requête paginée (B4).
    refunds: (n.refunds ?? []).map((r) => refundFromGraphql(r, n.id)),
    fulfillments: (n.fulfillments ?? []).map((f) => fulfillmentFromGraphql(f, { order_id: n.id, country_code: n.shippingAddress?.countryCodeV2 ?? null })),
  };
}

// ── Exclusions (brief §9, ORDER_EXCLUSION_REASONS) — la commande est conservée et comptée ─────
export function exclusionReason(facts, settings = {}) {
  if (facts.is_test) return "test";
  if (facts.cancelled_at) return "cancelled";
  if (facts.source_name === "shopify_draft_order") return "draft";
  const productLines = (facts.lines ?? []);
  if (productLines.length && productLines.every((l) => l.is_gift_card)) return "gift_card_only";
  const tag = settings.b2b_tag ? String(settings.b2b_tag).trim().toLowerCase() : null;
  if (facts.is_b2b_entity || (tag && (facts.tags ?? []).some((t) => String(t).trim().toLowerCase() === tag))) return "b2b";
  return null;
}

// ── Commande figée : ligne orders + lignes order_margins (legacy + F1) ────────────────────────
// costLookup(variant_id) → ligne variant_costs | null ; refundRows = remboursements DÉTAILLÉS connus
// (base + webhook) ; settings = shop_settings. Retour pur, sans shop_domain (l'appelant l'ajoute).
export function normalizeOrder({ facts, settings = {}, costLookup = () => null, refundRows = [], now = new Date() }) {
  const tz = settings.shop_timezone || "UTC";
  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  const refundQty = refundedQuantities([...(facts.refunds ?? []).filter((r) => r.detailed), ...refundRows]);
  const exclusion = exclusionReason(facts, settings);
  const createdDate = new Date(facts.created_at ?? nowIso);
  const productLines = (facts.lines ?? []).filter((l) => l.product_id || l.variant_id); // tip / frais custom ignorés (legacy)

  const econ = productLines.map((l) => {
    const q = refundQty.get(l.line_item_id) ?? { refunded_qty: 0, restocked_qty: null };
    const costRow = l.variant_id ? (costLookup(l.variant_id) ?? null) : null;
    const e = computeLineEconomics({
      line: { ...l, refunded_qty: q.refunded_qty, restocked_qty: q.restocked_qty },
      order: { taxes_included: facts.taxes_included },
      costRow, settings, now: createdDate,
    });
    return { line: l, costRow, econ: e, refunded_qty: q.refunded_qty };
  });

  const shippingHt = round2(num(facts.shipping_charged) - num(facts.shipping_tax));
  const caHt = round2(econ.reduce((s, x) => s + (x.econ.is_gift_card ? 0 : round2(x.econ.unit_price_ht * x.line.quantity)), 0) + shippingHt);

  const orderRow = {
    order_id: facts.order_id, order_name: facts.order_name,
    created_at: facts.created_at, processed_at: facts.processed_at, cancelled_at: facts.cancelled_at,
    day_local: dayLocal(facts.created_at, tz) ?? nowIso.slice(0, 10),
    is_test: facts.is_test === true, source_name: facts.source_name,
    gateway_names: facts.gateway_names ?? [],
    purchasing_company_id: facts.purchasing_company_id ?? null,
    customer_id: facts.customer_id ?? null, customer_order_index: facts.customer_order_index ?? null,
    currency_code: facts.currency_code ?? settings.shop_currency ?? "EUR",
    taxes_included: facts.taxes_included === true,
    subtotal_ttc: facts.subtotal_ttc ?? null, discounts_amount: round2(facts.discounts_amount),
    discount_codes: facts.discount_codes ?? [],
    shipping_charged: round2(facts.shipping_charged), tax_amount: round2(facts.tax_amount),
    total_ttc: facts.total_ttc ?? null, ca_ht: caHt,
    utm_source: facts.utm_source, utm_medium: facts.utm_medium, utm_campaign: facts.utm_campaign,
    utm_content: facts.utm_content, utm_term: facts.utm_term,
    visit_source: facts.visit_source, visit_source_type: facts.visit_source_type, landing_page: facts.landing_page,
    attribution_ready: facts.attribution_ready === true,
    country_code: facts.country_code ?? null,
    excluded_reason: exclusion,
    updated_at: nowIso,
  };

  // Colonnes LEGACY (B7) : buildHistoryRow sur une forme Shopify reconstruite ; remboursements
  // synthétisés depuis les quantités réglées pour que effectiveRefundedQty (D4) les compte.
  const legacyOrder = {
    id: facts.order_id, createdAt: facts.created_at, currencyCode: orderRow.currency_code,
    refunds: econ.filter((x) => x.refunded_qty > 0).map((x) => ({
      transactions: [{ kind: "REFUND", status: "SUCCESS" }],
      refundLineItems: [{ lineItem: { id: x.line.line_item_id }, quantity: x.refunded_qty }],
    })),
  };
  const legacySettings = {
    shopTaxesIncluded: facts.taxes_included !== false,
    shopifyFee: settings.shopify_fee_pct ?? 2.0, stripeFee: settings.processor_fee_pct ?? 1.5,
    processorFixedFee: settings.processor_fixed_fee ?? 0.25,
  };
  const legacyLine = (l) => ({
    id: l.line_item_id, quantity: l.quantity,
    variant: l.variant_id ? { id: l.variant_id } : null, product: l.product_id ? { id: l.product_id } : null,
    originalUnitPriceSet: { shopMoney: { amount: String(l.unit_price_original ?? l.unit_price) } },
    discountedUnitPriceAfterAllDiscountsSet: { shopMoney: { amount: String(l.unit_price) } },
    discountAllocations: [],
  });
  const legacyRows = econ.map((x) => buildHistoryRow(legacyOrder, legacyLine(x.line), x.line.is_gift_card ? null : x.costRow, legacySettings));
  allocateOrderFixedFee(legacyRows, num(legacySettings.processorFixedFee));

  // Allocation CM2 par ligne (A4, A5) telle que connue à l'ingestion (frais réels : plus tard, à la lecture).
  const costs = orderCosts({ order: { country_code: orderRow.country_code, shipping_charged: orderRow.shipping_charged, total_ttc: orderRow.total_ttc, gateway_names: orderRow.gateway_names }, fees: [], settings });
  const enriched = econ.map((x) => ({
    line_item_id: x.line.line_item_id,
    line_ca_ht: x.econ.is_gift_card ? null : round2(x.econ.unit_price_ht * x.line.quantity),
    units: x.line.quantity,
    packaging_override_unit: x.econ.packaging_override_unit ?? null,
  }));
  const alloc = allocateOrderCosts({ lines: enriched, costs });

  const lineRows = econ.map((x, i) => {
    const a = alloc.get(x.line.line_item_id) ?? { payment: 0, shipping: 0, packaging: 0 };
    const gift = x.econ.is_gift_card === true;
    return {
      ...legacyRows[i],
      order_created_at: facts.created_at,
      currency_code: orderRow.currency_code,
      day_local: orderRow.day_local,
      unit_price_ht: round2(x.econ.unit_price_ht),
      tax_lines: x.econ.tax_lines ?? [],
      is_gift_card: gift,
      cm1_components: x.econ.cm1_components,
      cm1_unit: x.econ.cm1_unit == null ? null : round2(x.econ.cm1_unit),
      cm2_alloc: gift ? null : { emballage: round2(a.packaging), paiement: round2(a.payment), port_marchand: round2(a.shipping) },
      breakdown_version: BREAKDOWN_VERSION,
      cost_source: gift ? "excluded" : legacyRows[i].cost_source,
    };
  });

  return { orderRow, lineRows, exclusion, refundedByLine: refundQty };
}

// ── customers_agg depuis les commandes (niveau 1 : customer_id seul) — reconstructible ────────
// orders : lignes `orders` (customer_id non nul, non exclues) ; lines : lignes order_margins de ces
// commandes (quantity, effective_qty, cm1_unit, cm2_alloc, cost_source, is_gift_card).
export function customersAggFromOrders({ orders = [], lines = [], now = new Date() } = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  const linesByOrder = new Map();
  for (const l of lines) { const arr = linesByOrder.get(l.order_id) ?? []; arr.push(l); linesByOrder.set(l.order_id, arr); }
  const byCustomer = new Map();
  for (const o of orders) {
    if (!o.customer_id || o.excluded_reason) continue;
    const arr = byCustomer.get(o.customer_id) ?? []; arr.push(o); byCustomer.set(o.customer_id, arr);
  }
  const rows = [];
  for (const [customer_id, list] of byCustomer) {
    list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const first = list[0], second = list[1] ?? null, last = list[list.length - 1];
    let units = 0, caHt = 0, cm2 = 0, cm2Known = true;
    for (const o of list) {
      caHt += num(o.ca_ht);
      for (const l of linesByOrder.get(o.order_id) ?? []) {
        if (l.is_gift_card || l.cost_source === "excluded") continue;
        const q = l.effective_qty ?? l.quantity ?? 0;
        units += intPos(q, 0);
        if (l.cm1_unit == null || l.cost_source === "missing") { cm2Known = false; continue; }
        const a = l.cm2_alloc ?? {};
        cm2 += round2(num(l.cm1_unit) * intPos(q, 0)) - round2(num(a.emballage)) - round2(num(a.paiement)) - round2(num(a.port_marchand));
      }
    }
    rows.push({
      customer_id,
      first_order_at: first.created_at, first_order_day: first.day_local ?? dayLocal(first.created_at, "UTC"),
      cohort_month: String(first.day_local ?? first.created_at).slice(0, 7),
      first_channel: first.visit_source || first.source_name || null,
      first_utm_source: first.utm_source ?? null,
      orders_count: list.length, units,
      ca_ht_total: round2(caHt),
      cm2_total: cm2Known && lines.length ? round2(cm2) : null,
      last_order_at: last.created_at,
      second_order_at: second ? second.created_at : null,
      refreshed_at: nowIso,
    });
  }
  return rows;
}
