// ════════════════════════════════════════════════════════════════════════════════
//  LOT 25 — Sync v2 (F2) : normaliseur unique, fenêtres, remboursements, retours, expéditions,
//  clients, exclusions, et scans statiques (routes ↔ TOML, scopes, aucun champ nominatif,
//  colonnes mutables ⊂ hors snapshot, API 2026-01, cron). PUR : aucun I/O.
//  Pour lancer : node tests/lot25_sync.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "node:fs";
import {
  fromWebhookPayload, fromGraphqlNode, normalizeOrder, exclusionReason, dayLocal, promisedAt,
  refundFromWebhook, refundFromGraphql, refundedQuantities, returnFromWebhook, returnFromGraphql,
  fulfillmentFromWebhook, fulfillmentFromGraphql, fulfillmentEventPatch, customersAggFromOrders, gid, BREAKDOWN_VERSION,
} from "../app/lib/sync/normalize.js";
import {
  monthlyWindows, historyFloor, backfillPlan, reconcileWindow, bulkFinishStatus, scopeHasAllOrders,
  journeyRepullCandidates, pickNextJob, isStale, chunk,
} from "../app/lib/sync/windows.js";
import { ordersBulkQuery, refundsFilter, returnsFilter } from "../app/lib/sync/queries.js";
import { SYNC_QUERY_MARKERS, isOurSyncQuery } from "../app/lib/bulkResume.js";
import { ORDER_MARGINS_SNAPSHOT_COLUMNS, ORDER_MARGINS_MUTABLE_COLUMNS, ORDER_EXCLUSION_REASONS } from "../app/lib/schema.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const near = (a, b, eps = 0.005) => a != null && b != null && Math.abs(a - b) < eps;
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\/.*$/gm, "").replace(/#.*$/gm, "");

const sm = (a) => ({ shop_money: { amount: a, currency_code: "EUR" }, presentment_money: { amount: "999", currency_code: "USD" } });
const SM = (a) => ({ shopMoney: { amount: a } });
const CREATED = "2026-08-15T22:30:00Z";

// ── Fixture : la MÊME commande sous ses deux formes ────────────────────────────────────────────
const WEBHOOK = {
  id: 1001, admin_graphql_api_id: "gid://shopify/Order/1001", name: "#1001",
  created_at: CREATED, processed_at: CREATED, cancelled_at: null, test: false, source_name: "web",
  payment_gateway_names: ["shopify_payments"], company: null, customer: { id: 77, email: "REDACTED" },
  currency: "EUR", taxes_included: true,
  subtotal_price_set: sm("98.00"), total_discounts_set: sm("12.00"), total_shipping_price_set: sm("5.90"),
  total_tax_set: sm("8.98"), total_price_set: sm("103.90"),
  discount_codes: [{ code: "INFLU10", amount: "12.00", type: "percentage" }],
  shipping_lines: [{ price_set: sm("5.90"), tax_lines: [{ title: "TVA", rate: 0.2, price_set: sm("0.98") }] }],
  line_items: [
    { id: 11, admin_graphql_api_id: "gid://shopify/LineItem/11", product_id: 501, variant_id: 9001, quantity: 2, gift_card: false,
      price_set: sm("30.00"), discount_allocations: [{ amount_set: sm("12.00") }], tax_lines: [{ title: "TVA", rate: 0.2, price_set: sm("8.00") }] },
    { id: 12, admin_graphql_api_id: "gid://shopify/LineItem/12", product_id: 502, variant_id: 9002, quantity: 1, gift_card: true,
      price_set: sm("50.00"), discount_allocations: [], tax_lines: [] },
  ],
  shipping_address: { country_code: "FR", address1: "REDACTED" }, refunds: [], fulfillments: [], tags: "vip, b2b-client",
};
const NODE = {
  __typename: "Order", id: "gid://shopify/Order/1001", name: "#1001", createdAt: CREATED, processedAt: CREATED, cancelledAt: null,
  test: false, sourceName: "web", paymentGatewayNames: ["shopify_payments"], currencyCode: "EUR", taxesIncluded: true, tags: ["vip", "b2b-client"],
  subtotalPriceSet: SM("98.00"), totalDiscountsSet: SM("12.00"), totalShippingPriceSet: SM("5.90"), totalTaxSet: SM("8.98"), totalPriceSet: SM("103.90"),
  discountCodes: ["INFLU10"], customer: { id: "gid://shopify/Customer/77" }, shippingAddress: { countryCodeV2: "FR" },
  purchasingEntity: { __typename: "PurchasingCustomer" }, customerJourneySummary: null, refunds: [], fulfillments: [],
  lineItems: [
    { __typename: "LineItem", id: "gid://shopify/LineItem/11", quantity: 2, isGiftCard: false, product: { id: "gid://shopify/Product/501" }, variant: { id: "gid://shopify/ProductVariant/9001" },
      originalUnitPriceSet: SM("30.00"), discountedUnitPriceAfterAllDiscountsSet: SM("24.00"), taxLines: [{ title: "TVA", rate: 0.2, priceSet: SM("8.00") }] },
    { __typename: "LineItem", id: "gid://shopify/LineItem/12", quantity: 1, isGiftCard: true, product: { id: "gid://shopify/Product/502" }, variant: { id: "gid://shopify/ProductVariant/9002" },
      originalUnitPriceSet: SM("50.00"), discountedUnitPriceAfterAllDiscountsSet: SM("50.00"), taxLines: [] },
  ],
  shippingLines: [{ __typename: "ShippingLine", id: "gid://shopify/ShippingLine/1", originalPriceSet: SM("5.90"), discountedPriceSet: SM("5.90"), taxLines: [{ title: "TVA", rate: 0.2, priceSet: SM("0.98") }] }],
};
const SETTINGS = {
  shop_domain: "s.myshopify.com", shop_timezone: "Europe/Paris", shop_currency: "EUR", shop_country_code: "FR",
  shopify_fee_pct: 2, processor_fee_pct: 1.5, processor_fixed_fee: 0.25, gateway_fee_rules: [],
  shipping_cost_rules: { default: 4 }, packaging_cost_per_order: 1, delivery_promise_days: 3, return_window_days: 30,
};
const COST_V1 = { variant_id: "gid://shopify/ProductVariant/9001", prix_achat: 5, port_entrant: 1, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Autre", source: "confirmed", customs_confirmed: true, landed_cost_override: 6 };
const lookup = (vid) => (vid === COST_V1.variant_id ? COST_V1 : null);

console.log("\n── T1 : un seul normaliseur — webhook ≡ GraphQL ──");
{
  const a = fromWebhookPayload(WEBHOOK), b = fromGraphqlNode(NODE);
  const cmp = (f) => { const { source, ...rest } = f; void source; return JSON.stringify(rest); };
  ok(cmp(a) === cmp(b), "OrderFacts identiques depuis le webhook et depuis le nœud GraphQL (hors champ source)");
  ok(a.order_id === "gid://shopify/Order/1001" && a.customer_id === "gid://shopify/Customer/77", "ids numériques du webhook → gids");
  ok(a.lines[0].unit_price === 24 && a.lines[0].unit_price_original === 30, "webhook : prix après remises = original − allocations/quantité (D1 repli)");
  ok(a.lines[0].tax_lines[0].amount === 8 && a.shipping_tax === 0.98 && a.shipping_charged === 5.9, "taxes de ligne et taxe du port lues, jamais supposées");
  ok(a.discount_codes[0] === "INFLU10" && b.discount_codes[0] === "INFLU10", "codes promo : objets (webhook) et chaînes (GraphQL) → même liste");
  ok(a.country_code === "FR" && !JSON.stringify(a).includes("REDACTED"), "seul le code pays est retenu : aucun champ nominatif ne traverse le normaliseur");
  ok(a.attribution_ready === false && a.customer_order_index === null, "webhook : attribution non prête (re-tirage différé)");
  const ready = fromGraphqlNode({ ...NODE, customerJourneySummary: { ready: true, customerOrderIndex: 1, lastVisit: { source: "facebook", sourceType: "SOCIAL", landingPage: "/x", utmParameters: { source: "facebook", medium: "cpc", campaign: "C1", content: null, term: null } } } });
  ok(ready.attribution_ready === true && ready.customer_order_index === 1 && ready.utm_source === "facebook" && ready.utm_campaign === "C1", "GraphQL : résumé de parcours → rang client + UTM");
  ok(fromGraphqlNode({ ...NODE, customer: null, shippingAddress: null }).customer_id === null, "client invité / champ non approuvé → null, pas d'erreur");
  ok(gid("Order", "gid://shopify/Order/5") === "gid://shopify/Order/5" && gid("Order", 5) === "gid://shopify/Order/5" && gid("Order", null) === null, "gid : idempotent, numérique → gid, null → null");
}

console.log("\n── T2 : commande figée (orders + order_margins legacy + F1) ──");
{
  const facts = fromWebhookPayload(WEBHOOK);
  const { orderRow, lineRows, exclusion } = normalizeOrder({ facts, settings: SETTINGS, costLookup: lookup, now: new Date("2026-09-22T10:00:00Z") });
  ok(exclusion === null && orderRow.excluded_reason === null, "commande normale : non exclue");
  ok(orderRow.day_local === "2026-08-16", "day_local dans le fuseau boutique (22:30 UTC → 16 août à Paris)");
  ok(near(orderRow.ca_ht, 44.92), `CA HT = 2 × 20 (24 TTC − 4 taxe) + port HT 4,92 = 44,92 (obtenu ${orderRow.ca_ht})`);
  ok(orderRow.currency_code === "EUR" && orderRow.shipping_charged === 5.9 && orderRow.tax_amount === 8.98 && orderRow.discount_codes[0] === "INFLU10", "ligne orders : devise, port client (décision 1), taxes, codes");
  ok(lineRows.length === 2, "deux lignes produit (la carte cadeau est conservée, marquée)");
  const l1 = lineRows[0], l2 = lineRows[1];
  ok(near(l1.unit_price_ht, 20) && near(l1.cm1_unit, 14) && l1.cost_source === "confirmed", "F1 : unit_price_ht 20, cm1_unit 14 (coût rendu saisi 6), source confirmée");
  ok(l1.breakdown_version === BREAKDOWN_VERSION && l1.day_local === "2026-08-16" && Array.isArray(l1.tax_lines), "F1 : breakdown_version, day_local, tax_lines figés");
  ok(near(l1.cm2_alloc.emballage, 1) && near(l1.cm2_alloc.port_marchand, 4) && near(l1.cm2_alloc.paiement, 0), "cm2_alloc : emballage 1 (pool entier, la carte cadeau n'a pas de CA), port marchand 4 (règle), paiement 0 (aucune règle)");
  ok(near(l1.net_unit_revenue, 24) && typeof l1.unit_net_margin === "number" && near(l1.line_net_revenue, 48), "legacy (B7) : net_unit_revenue, unit_net_margin, line_net_revenue remplis par buildHistoryRow");
  ok(l2.is_gift_card === true && l2.cost_source === "excluded" && l2.cm1_unit === null && l2.line_net_margin === null, "carte cadeau : cost_source 'excluded', marges nulles (jamais 0)");
  ok(l1.refunded_qty === 0 && l1.effective_qty === 2, "sans remboursement : effective_qty = quantité");
  const b2b = normalizeOrder({ facts, settings: { ...SETTINGS, b2b_tag: "B2B-Client" }, costLookup: lookup });
  ok(b2b.exclusion === "b2b", "étiquette B2B (insensible à la casse) → exclue 'b2b' (décision 9)");
  const missing = normalizeOrder({ facts, settings: SETTINGS, costLookup: () => null });
  ok(missing.lineRows[0].cost_source === "missing" && missing.lineRows[0].cm1_unit === null && near(missing.orderRow.ca_ht, 44.92), "coût manquant : CM1 null, CA HT quand même connu");
}

console.log("\n── T3 : exclusions (brief §9) ──");
{
  const f = fromWebhookPayload(WEBHOOK);
  ok(exclusionReason({ ...f, is_test: true }) === "test", "commande test → 'test'");
  ok(exclusionReason({ ...f, cancelled_at: CREATED }) === "cancelled", "annulée → 'cancelled'");
  ok(exclusionReason({ ...f, source_name: "shopify_draft_order" }) === "draft", "brouillon → 'draft'");
  ok(exclusionReason({ ...f, lines: [f.lines[1]] }) === "gift_card_only", "cartes cadeau seules → 'gift_card_only'");
  ok(exclusionReason({ ...f, is_b2b_entity: true }) === "b2b", "entité acheteuse Company → 'b2b'");
  ok(exclusionReason(f, {}) === null, "sinon → null");
  ok(["test", "cancelled", "draft", "gift_card_only", "b2b"].every((r) => ORDER_EXCLUSION_REASONS.includes(r)), "toutes les raisons émises sont dans le CHECK de orders.excluded_reason");
}

console.log("\n── T4 : remboursements (D4 réglés, A2 restock) ──");
{
  const RW = { id: 5001, admin_graphql_api_id: "gid://shopify/Refund/5001", order_id: 1001, created_at: "2026-08-20T10:00:00Z",
    refund_line_items: [{ line_item_id: 11, quantity: 1, restock_type: "return", subtotal_set: sm("24.00") }],
    transactions: [{ kind: "refund", status: "success", amount: "24.00" }], refund_shipping_lines: [{ subtotal_amount_set: sm("5.90") }] };
  const RG = { id: "gid://shopify/Refund/5001", createdAt: "2026-08-20T10:00:00Z", totalRefundedSet: SM("24.00"),
    refundShippingLines: { edges: [{ node: { subtotalAmountSet: SM("5.90") } }] },
    refundLineItems: { edges: [{ node: { quantity: 1, restockType: "RETURN", subtotalSet: SM("24.00"), lineItem: { id: "gid://shopify/LineItem/11" } } }] },
    transactions: { edges: [{ node: { kind: "REFUND", status: "SUCCESS", amountSet: SM("24.00") } }] } };
  const a = refundFromWebhook(RW, { timeZone: "Europe/Paris" }), b = refundFromGraphql(RG, "gid://shopify/Order/1001", { timeZone: "Europe/Paris" });
  ok(a.refund_id === b.refund_id && a.order_id === b.order_id && a.settled && b.settled && a.total_refunded === 24 && b.total_refunded === 24 && a.shipping_refunded === 5.9 && b.shipping_refunded === 5.9,
    "webhook ≡ GraphQL : id, commande, réglé, montants, port remboursé");
  ok(JSON.stringify(a.line_items) === JSON.stringify(b.line_items) && a.line_items[0].restock_type === "return", "lignes remboursées identiques, restock_type normalisé en minuscules");
  ok(a.detailed === true && refundFromGraphql({ id: "gid://shopify/Refund/6", createdAt: CREATED, totalRefundedSet: SM("1") }, "o").detailed === false,
    "en-tête bulk (sans lignes) → detailed=false : jamais écrit par-dessus le détail");
  const q = refundedQuantities([a, b]);
  ok(q.get("gid://shopify/LineItem/11").refunded_qty === 1 && q.get("gid://shopify/LineItem/11").restocked_qty === 1, "dédoublonnage par refund_id : 1 remboursée, 1 restockée (pas 2)");
  const pending = refundFromWebhook({ ...RW, id: 5002, admin_graphql_api_id: null, transactions: [{ kind: "refund", status: "pending" }] });
  ok(!pending.settled && refundedQuantities([pending]).size === 0, "remboursement non réglé → rien décompté (D4)");
  const noRestock = refundFromWebhook({ ...RW, id: 5003, admin_graphql_api_id: null, refund_line_items: [{ line_item_id: 11, quantity: 2, restock_type: "no_restock" }] });
  const q2 = refundedQuantities([noRestock]).get("gid://shopify/LineItem/11");
  ok(q2.refunded_qty === 2 && q2.restocked_qty === 0, "no_restock : remboursées 2, restockées 0 (connu)");
  const facts = fromWebhookPayload(WEBHOOK);
  const { lineRows } = normalizeOrder({ facts, settings: SETTINGS, costLookup: lookup, refundRows: [a] });
  ok(lineRows[0].refunded_qty === 1 && lineRows[0].effective_qty === 1, "commande ingérée APRÈS son remboursement (B12a) : quantités remboursées dans le snapshot");
  ok(ORDER_MARGINS_MUTABLE_COLUMNS.every((c) => !ORDER_MARGINS_SNAPSHOT_COLUMNS.includes(c)), "colonnes mutables (quantités) disjointes des colonnes de snapshot");
}

console.log("\n── T5 : retours, expéditions, promesse ──");
{
  const req = returnFromWebhook({ admin_graphql_api_id: "gid://shopify/Return/9", status: "requested", order: { admin_graphql_api_id: "gid://shopify/Order/1001" }, total_return_line_items: 1,
    return_line_items: [{ quantity: 1, return_reason: "wrong_item", return_reason_note: "", fulfillment_line_item: { line_item: { admin_graphql_api_id: "gid://shopify/LineItem/11" } } }] },
    { timeZone: "Europe/Paris", now: new Date("2026-08-21T10:00:00Z") });
  ok(req.status === "REQUESTED" && req.requested_at && !req.closed_at && req.line_items[0].return_reason === "WRONG_ITEM" && req.line_items[0].line_item_id === "gid://shopify/LineItem/11" && !req.partial,
    "returns/request : statut, motif (enum), ligne rattachée");
  const close = returnFromWebhook({ admin_graphql_api_id: "gid://shopify/Return/9", order_id: 1001, status: "closed" }, { now: new Date("2026-08-25T10:00:00Z") });
  ok(close.status === "CLOSED" && close.closed_at && close.line_items.length === 0 && close.order_id === "gid://shopify/Order/1001", "returns/close : sans lignes (fusion en base), order_id numérique → gid");
  const g = returnFromGraphql({ id: "gid://shopify/Return/9", status: "OPEN", createdAt: "2026-08-21T10:00:00Z", closedAt: null,
    returnLineItems: { edges: [{ node: { quantity: 1, returnReason: "WRONG_ITEM", returnReasonNote: null, fulfillmentLineItem: { lineItem: { id: "gid://shopify/LineItem/11" } } } }] } }, "gid://shopify/Order/1001");
  ok(g.status === "OPEN" && g.requested_at === "2026-08-21T10:00:00Z" && g.line_items[0].return_reason === "WRONG_ITEM", "retour GraphQL : même forme");

  const fw = fulfillmentFromWebhook({ id: 7, admin_graphql_api_id: "gid://shopify/Fulfillment/7", order_id: 1001, status: "success", created_at: "2026-08-17T08:00:00Z", updated_at: "2026-08-19T09:00:00Z",
    tracking_company: "Colissimo", tracking_numbers: ["ABC"], shipment_status: "delivered", destination: { country_code: "FR" } }, { timeZone: "Europe/Paris" });
  ok(fw.fulfillment_id === "gid://shopify/Fulfillment/7" && fw.delivered_at === "2026-08-19T09:00:00Z" && fw.last_event_status === "DELIVERED" && fw.tracking_numbers[0] === "ABC" && fw.day_local === "2026-08-17",
    "fulfillments/create : livrée → delivered_at, suivi, jour d'expédition");
  const fg = fulfillmentFromGraphql({ id: "gid://shopify/Fulfillment/7", createdAt: "2026-08-17T08:00:00Z", status: "SUCCESS", displayStatus: "DELIVERED", deliveredAt: "2026-08-19T09:00:00Z", estimatedDeliveryAt: null, inTransitAt: "2026-08-17T12:00:00Z", trackingInfo: [{ company: "Colissimo", number: "ABC" }] }, { order_id: "gid://shopify/Order/1001", country_code: "FR" }, { timeZone: "Europe/Paris" });
  ok(fg.delivered_at === fw.delivered_at && fg.tracking_company === "Colissimo" && fg.country_code === "FR", "Order.fulfillments (bulk) : deliveredAt lu directement, pas besoin des événements");
  const ev = fulfillmentEventPatch({ fulfillment_id: 7, order_id: 1001, status: "delivered", happened_at: "2026-08-19T09:00:00Z" });
  ok(ev.delivered === true && ev.fulfillment_id === "gid://shopify/Fulfillment/7" && ev.status === "DELIVERED", "fulfillment_events/create DELIVERED → correctif delivered_at");
  ok(promisedAt("2026-08-14T10:00:00Z", 3, "Europe/Paris") === "2026-08-19T10:00:00.000Z", "promesse 3 jours ouvrés depuis un vendredi → mercredi (lun-ven, A17)");
  ok(promisedAt("2026-08-14T10:00:00Z", null) === null && promisedAt("bad", 3) === null, "promesse absente ou date invalide → null");
  ok(dayLocal("2026-08-15T22:30:00Z", "Europe/Paris") === "2026-08-16" && dayLocal("2026-08-15T22:30:00Z", "UTC") === "2026-08-15" && dayLocal("x") === null, "dayLocal : fuseau respecté, invalide → null");
}

console.log("\n── T6 : fenêtres, plan de backfill, réconciliation (B1, B3, B9) ──");
{
  const NOW = "2026-09-22T12:00:00.000Z";
  const w = monthlyWindows({ from: "2026-06-15T00:00:00Z", to: NOW });
  ok(w.length === 4 && w[0].start === "2026-09-01T00:00:00.000Z" && w[0].end === NOW && w[3].start === "2026-06-15T00:00:00.000Z" && w[3].end === "2026-07-01T00:00:00.000Z",
    "fenêtres mensuelles UTC, la plus récente d'abord, première tronquée à from");
  ok(monthlyWindows({ from: NOW, to: NOW }).length === 0 && monthlyWindows({ from: "x", to: NOW }).length === 0, "fenêtre vide ou invalide → aucune");
  ok(historyFloor({ now: NOW, hasAllOrders: false }) === "2026-07-24T12:00:00.000Z", "sans read_all_orders : plancher = 60 jours");
  ok(historyFloor({ now: NOW, hasAllOrders: true, historyMonths: 24 }) === "2024-09-01T00:00:00.000Z", "avec read_all_orders : 24 mois calendaires");
  const p1 = backfillPlan({ now: NOW, hasAllOrders: false });
  ok(p1.length === 3 && p1[2].start === "2026-07-24T12:00:00.000Z", "plan sans scope : 3 fenêtres (sept., août, fin juillet)");
  const p2 = backfillPlan({ now: NOW, hasAllOrders: true, historyMonths: 24, existingWindows: p1.map((x) => ({ window_start: x.start })) });
  ok(p2.length === 23 && p2[0].start === "2026-07-01T00:00:00.000Z" && p2[22].start === "2024-09-01T00:00:00.000Z", "après approbation : 23 fenêtres manquantes créées (juillet plein inclus, août/sept. déjà couverts)");
  ok(backfillPlan({ now: NOW, hasAllOrders: true, historyMonths: 24, existingWindows: [...p1, ...p2].map((x) => ({ window_start: x.start })) }).length === 0, "replanification idempotente : rien de nouveau");
  const r1 = reconcileWindow({ cursor: "2026-09-21T05:00:00Z", now: NOW });
  ok(r1.start === "2026-09-20T05:00:00.000Z" && r1.end === NOW, "réconciliation : curseur − 1 jour de chevauchement");
  ok(reconcileWindow({ cursor: null, now: NOW }).start === "2026-07-24T12:00:00.000Z", "sans curseur : 60 jours");
  ok(reconcileWindow({ cursor: "2030-01-01T00:00:00Z", now: NOW }).start === NOW, "curseur dans le futur → jamais au-delà de maintenant");
  ok(reconcileWindow({ cursor: null, now: NOW, floor: "2026-09-01T00:00:00Z" }).start === "2026-09-01T00:00:00.000Z", "plancher respecté");
  const s = bulkFinishStatus({ admin_graphql_api_id: "gid://shopify/BulkOperation/5", status: "completed", error_code: null });
  ok(s.id === "gid://shopify/BulkOperation/5" && s.status === "COMPLETED" && s.errorCode === null, "bulk_operations/finish : minuscules → majuscules des requêtes");
  ok(scopeHasAllOrders("read_orders, read_all_orders") && !scopeHasAllOrders("read_orders") && !scopeHasAllOrders(null), "détection de read_all_orders dans la chaîne de scopes");
  const cands = journeyRepullCandidates([{ order_id: "a", created_at: "2026-09-10T00:00:00Z", attribution_ready: false }, { order_id: "b", created_at: "2026-07-01T00:00:00Z", attribution_ready: false }, { order_id: "c", created_at: "2026-09-10T00:00:00Z", attribution_ready: true }], NOW);
  ok(cands.length === 1 && cands[0] === "a", "re-tirage : non prêtes de moins de 30 jours seulement");
  ok(pickNextJob([{ status: "pending", window_start: "2026-07-01" }, { status: "pending", window_start: "2026-09-01" }, { status: "running", window_start: "2026-10-01" }]).window_start === "2026-09-01", "prochain job : pending, fenêtre la plus récente");
  ok(isStale({ status: "running", started_at: "2026-09-22T11:00:00Z" }, NOW) && !isStale({ status: "running", started_at: "2026-09-22T11:50:00Z" }, NOW) && !isStale({ status: "pending", started_at: "2026-09-22T09:00:00Z" }, NOW), "stagnation : running depuis plus de 30 min");
  ok(chunk([1, 2, 3, 4, 5], 2).length === 3 && chunk([], 2).length === 0, "chunk");
}

console.log("\n── T7 : requêtes ──");
{
  const q = ordersBulkQuery({ start: "2026-08-01T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" });
  ok(q.includes(`created_at:>='2026-08-01T00:00:00.000Z' AND created_at:<'2026-09-01T00:00:00.000Z'`) && q.includes("sortKey: CREATED_AT"), "bulk backfill : fenêtre created_at + sortKey aligné (conseil doc)");
  const u = ordersBulkQuery({ start: "2026-09-20T00:00:00.000Z", end: "2026-09-22T00:00:00.000Z", by: "updated_at" });
  ok(u.includes("updated_at:>=") && u.includes("sortKey: UPDATED_AT"), "bulk réconciliation : updated_at");
  ok(isOurSyncQuery(q) && isOurSyncQuery(u) && SYNC_QUERY_MARKERS.every((m) => q.includes(m)), "les deux variantes portent les marqueurs de reconnaissance");
  ok(!/\bfirst\s*:/.test(q.replace(/customerJourneySummary[^}]*\}/, "")), "bulk : connexions sans first (le bulk pagine)");
  ok(refundsFilter({ start: "a", end: "b" }).includes("financial_status:refunded") && returnsFilter({ start: "a", end: "b" }).includes("return_status:returned"), "filtres des sous-ressources");
  const queries = src("../app/lib/sync/queries.js");
  ok(!/\b(email|phone|firstName|lastName|address1|address2|zip|city|displayName)\b/.test(queries), "aucun champ nominatif dans les requêtes (niveau 1)");
  ok(queries.includes("customer { id }") && queries.includes("shippingAddress { countryCodeV2 }") && queries.includes("purchasingEntity { __typename }"), "client : id seul ; adresse : pays seul ; entité B2B : type seul (sans read_companies)");
}

console.log("\n── T8 : customers_agg (niveau 1, reconstructible) ──");
{
  const orders = [
    { order_id: "o1", customer_id: "c1", created_at: "2026-06-03T10:00:00Z", day_local: "2026-06-03", ca_ht: 40, visit_source: "facebook", source_name: "web", utm_source: "facebook", excluded_reason: null },
    { order_id: "o2", customer_id: "c1", created_at: "2026-08-10T10:00:00Z", day_local: "2026-08-10", ca_ht: 60, visit_source: null, source_name: "web", utm_source: null, excluded_reason: null },
    { order_id: "o3", customer_id: "c2", created_at: "2026-08-12T10:00:00Z", day_local: "2026-08-12", ca_ht: 10, excluded_reason: null },
    { order_id: "o4", customer_id: null, created_at: "2026-08-12T10:00:00Z", day_local: "2026-08-12", ca_ht: 10, excluded_reason: null },
    { order_id: "o5", customer_id: "c1", created_at: "2026-08-13T10:00:00Z", day_local: "2026-08-13", ca_ht: 10, excluded_reason: "test" },
  ];
  const lines = [
    { order_id: "o1", quantity: 1, effective_qty: 1, cm1_unit: 14, cm2_alloc: { emballage: 1, paiement: 0, port_marchand: 4 }, cost_source: "confirmed", is_gift_card: false },
    { order_id: "o2", quantity: 2, effective_qty: 2, cm1_unit: 10, cm2_alloc: { emballage: 1, paiement: 1, port_marchand: 4 }, cost_source: "estimated", is_gift_card: false },
    { order_id: "o3", quantity: 1, effective_qty: 1, cm1_unit: null, cm2_alloc: null, cost_source: "missing", is_gift_card: false },
  ];
  const rows = customersAggFromOrders({ orders, lines, now: new Date("2026-09-22T00:00:00Z") });
  const c1 = rows.find((r) => r.customer_id === "c1"), c2 = rows.find((r) => r.customer_id === "c2");
  ok(rows.length === 2, "invité (customer_id null) ignoré ; commande exclue ignorée");
  ok(c1.orders_count === 2 && c1.cohort_month === "2026-06" && c1.first_channel === "facebook" && c1.second_order_at === "2026-08-10T10:00:00Z" && c1.last_order_at === "2026-08-10T10:00:00Z", "c1 : 2 commandes, cohorte juin, canal de la première, 2e achat");
  ok(c1.units === 3 && near(c1.ca_ht_total, 100) && near(c1.cm2_total, 9 + 14), "c1 : unités, CA HT, CM2 = Σ(cm1 × unités − allocations) = 9 + 14");
  ok(c2.cm2_total === null && c2.orders_count === 1 && c2.second_order_at === null, "c2 : coût manquant → CM2 null (jamais 0)");
}

console.log("\n── T9 : scans statiques — routes, TOML, scopes, cron, API, engine ──");
{
  const toml = src("../shopify.app.toml");
  const uris = [...toml.matchAll(/uri = "(\/webhooks\/[a-z_/]+)"/g)].map((m) => m[1]);
  ok(uris.length >= 7, `TOML : ${uris.length} abonnements webhooks internes`);
  for (const u of uris) {
    const file = new URL(`../app/routes/${u.slice(1).replace(/\//g, ".")}.jsx`, import.meta.url);
    ok(existsSync(file), `route ${u} → ${u.slice(1).replace(/\//g, ".")}.jsx existe`);
  }
  for (const t of ["orders/create", "orders/updated", "orders/cancelled", "refunds/create", "returns/request", "returns/close", "fulfillments/create", "fulfillment_events/create", "bulk_operations/finish", "app/scopes_update"]) {
    ok(toml.includes(`"${t}"`), `topic ${t} déclaré`);
  }
  const scopes = (toml.match(/^scopes = "([^"]+)"/m) ?? [])[1] ?? "";
  for (const s of ["read_orders", "read_customers", "read_returns", "read_fulfillments", "read_merchant_managed_fulfillment_orders", "read_third_party_fulfillment_orders", "read_shopify_payments_accounts", "read_products", "read_inventory"]) {
    ok(scopes.split(",").includes(s), `scope ${s} déclaré`);
  }
  ok(!scopes.split(",").includes("read_all_orders"), "read_all_orders ABSENT du TOML tant que non approuvé (B1)");
  ok(toml.includes("include_fields"), "orders/* : include_fields (charge utile réduite, B5)");
  for (const r of ["webhooks.orders", "webhooks.refunds", "webhooks.returns", "webhooks.fulfillments", "webhooks.bulk_operations"]) {
    const s = strip(src(`../app/routes/${r}.jsx`));
    ok(s.includes("authenticate.webhook(request)") && s.includes("recordWebhook(") && s.includes("finishWebhook("), `${r} : HMAC + dédoublonnage + statut d'événement`);
  }
  ok(strip(src("../app/routes/webhooks.bulk_operations.jsx")).includes("background(") && strip(src("../app/routes/webhooks.orders.jsx")).includes("background("), "waitUntil (background) sur bulk_operations/finish et customers_agg (B5c)");
  const ingest = strip(src("../app/lib/sync/ingest.server.js"));
  ok(ingest.includes("ORDER_MARGINS_MUTABLE_COLUMNS.includes(k)") && (ingest.match(/from\("order_margins"\)\.update\(/g) ?? []).length === 1,
    "order_margins : un seul UPDATE, filtré par ORDER_MARGINS_MUTABLE_COLUMNS (jamais un snapshot)");
  ok(ingest.includes('.upsert(orderRows, { onConflict: "shop_domain,order_id" })'), "orders : upsert complet (le dernier événement est la vérité)");
  const server = src("../app/shopify.server.js");
  ok(server.includes("ApiVersion.January26") && !server.includes("October25"), "API 2026-01 (B2)");
  const vercel = JSON.parse(src("../vercel.json"));
  ok(vercel.crons.some((c) => c.path === "/api/cron/sync") && vercel.crons.every((c) => /^\d+ \d+ \* \* \*$/.test(c.schedule)), "cron /api/cron/sync déclaré ; tous quotidiens (Hobby)");
  const cron = strip(src("../app/routes/api.cron.sync.jsx"));
  ok(cron.includes("export const config = { maxDuration: 300 };") && cron.includes("CRON_SECRET") && cron.includes('status: 401'), "cron sync : maxDuration 300, secret exigé");
  const scopesUpdate = strip(src("../app/routes/webhooks.app.scopes_update.jsx"));
  ok(scopesUpdate.includes("planBackfill(") && scopesUpdate.includes("scopeHasAllOrders("), "app/scopes_update : read_all_orders accordé → plan de backfill (B1)");
  for (const f of ["normalize.js", "windows.js", "queries.js", "ingest.server.js", "bulk.server.js", "jobs.server.js", "events.server.js", "background.server.js"]) {
    const s = src(`../app/lib/sync/${f}`);
    ok(!/from\s+["']\.\.\/engine\.js["']/.test(s), `sync/${f} : n'importe pas engine.js (0 diff, R2)`);
  }
  const legacyRoute = src("../app/routes/api.cron.profitability.jsx");
  ok(legacyRoute.includes("syncShopOrders"), "cron d'alerting inchangé : passe toujours par syncShopOrders (délégué)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 25 (sync v2) : ✓ Tous les tests passent"
  : ` BILAN LOT 25 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
