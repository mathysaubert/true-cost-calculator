// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Brique B — ingestion commandes (module pur app/lib/orderIngest.js)
//  Fixtures JSONL synthétiques APLATIES, enfants AVANT parents (éprouve le re-stitch).
//  Preuve au centime : line_net_margin vs ANCRE indépendante (computeMargin direct,
//  PAS via le module testé). engine.js intouché.
//  Pour lancer : node tests/lot6_order_ingest.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  parseBulkJsonl, effectiveRefundedQty, netUnitRevenue,
  buildOrderHistoryRows, countDistinctOrders,
} from "../app/lib/orderIngest.js";
import { computeMargin } from "../app/lib/engine.js";

let failures = 0;
const ok  = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const eur = (n) => (n == null ? "null" : Number(n).toFixed(2));
const cents = (a, b) => eur(a) === eur(b);

// Helpers fixtures
const mb = (amount) => ({ shopMoney: { amount } });
const jsonl = (objs) => objs.map((o) => JSON.stringify(o)).join("\n");
const SHOP = { shopTaxesIncluded: true, shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25 };
const COSTS = {
  V1: { prix_achat: 200, port_entrant: 50, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport", source: "confirmed" },
  V2: { prix_achat: 12,  port_entrant: 8,  qty_par_lot: 10, cout_emballage: 0.5, vat_regime: "franchise", shipping_model: "stock", pays_import: "Chine", categorie: "Textile", source: "confirmed" },
  V3: { prix_achat: 5,   port_entrant: 8,  qty_par_lot: 1, cout_emballage: 0, vat_regime: "franchise", shipping_model: "dropshipping", pays_import: "Chine", categorie: "Autre", source: "imported" },
};
const lookup = (vid) => COSTS[vid] ?? null;

// Ancre indépendante : engineInput à la main + computeMargin direct (pas orderIngest).
const anchorUnitMargin = (vid, prixVente, createdAt) => {
  const c = COSTS[vid];
  return computeMargin({
    prixVente, prixAchat: c.prix_achat, categorie: c.categorie, paysImport: c.pays_import,
    shipping: c.port_entrant, qty: c.qty_par_lot, coutEmballage: c.cout_emballage,
    vatRegime: c.vat_regime, shippingModel: c.shipping_model, shopTaxesIncluded: SHOP.shopTaxesIncluded,
    shopifyFee: SHOP.shopifyFee, stripeFee: SHOP.stripeFee, processorFixedFee: 0,
    retours: 0, ads: 0, fraisRetour: 0, now: new Date(createdAt),
  }).margeNette;
};

// ── F1 : assujetti/TTC mono-ligne, coûts confirmés — preuve au centime ──
console.log("\n── F1 : mono-ligne, preuve au centime ──");
{
  const created = "2026-06-10T10:00:00Z";
  const txt = jsonl([
    { id: "L1", __parentId: "O1", __typename: "LineItem", quantity: 3, variant: { id: "V1" }, product: { id: "P1" },
      originalUnitPriceSet: mb("600.00"), discountedUnitPriceAfterAllDiscountsSet: mb("600.00"), discountAllocations: [] },
    { id: "O1", createdAt: created, currencyCode: "USD" }, // parent APRÈS
  ]);
  const [order] = parseBulkJsonl(txt);
  const rows = buildOrderHistoryRows(order, lookup, SHOP);
  const r = rows[0];
  const unit = anchorUnitMargin("V1", 600, created);
  const anchorLine = unit * 3 - 0.25;             // 3 unités − fixe entier (mono-ligne)
  ok(rows.length === 1, "1 ligne produite");
  ok(cents(r.unit_net_margin, unit), `unit_net_margin = ancre (${eur(r.unit_net_margin)} = ${eur(unit)})`);
  ok(cents(r.line_net_margin, anchorLine), `line_net_margin AU CENTIME = ancre (${eur(r.line_net_margin)} = ${eur(anchorLine)})`);
  ok(cents(r.allocated_fixed_fee, 0.25), `fixe entier sur mono-ligne (${eur(r.allocated_fixed_fee)})`);
  ok(cents(r.line_net_revenue, 600 * 3), `line_net_revenue = 600×3 (${eur(r.line_net_revenue)})`);
  ok(r.effective_qty === 3 && r.cost_source === "confirmed", "effective_qty 3, source confirmed");
}

// ── F2 : franchise 2 lignes, remise order-level → prorata fixe + non-double-comptage ──
console.log("\n── F2 : multi-ligne, prorata fixe + remises AfterAll seul ──");
{
  const created = "2026-06-12T09:00:00Z";
  const txt = jsonl([
    { allocatedAmountSet: mb("10.00"), __parentId: "L2a", __typename: "DiscountAllocation" }, // enfant de la ligne
    { id: "L2a", __parentId: "O2", __typename: "LineItem", quantity: 2, variant: { id: "V2" }, product: { id: "P2" },
      originalUnitPriceSet: mb("50.00"), discountedUnitPriceAfterAllDiscountsSet: mb("45.00") }, // AfterAll = 45 (déjà net)
    { id: "L2b", __parentId: "O2", __typename: "LineItem", quantity: 1, variant: { id: "V3" }, product: { id: "P3" },
      originalUnitPriceSet: mb("30.00"), discountedUnitPriceAfterAllDiscountsSet: mb("30.00"), discountAllocations: [] },
    { id: "O2", createdAt: created, currencyCode: "USD" },
  ]);
  const [order] = parseBulkJsonl(txt);
  const rows = buildOrderHistoryRows(order, lookup, SHOP);
  const ra = rows.find((r) => r.line_item_id === "L2a");
  const rb = rows.find((r) => r.line_item_id === "L2b");

  // non-double-comptage : revenu = AfterAll (45), jamais 50 ni 40 (45 − alloc à nouveau)
  ok(cents(ra.net_unit_revenue, 45), `L2a revenu = AfterAll seul = 45 (${eur(ra.net_unit_revenue)}), pas 50 ni 40`);

  // prorata : Σ allocated_fixed_fee = fixe commande, au centime
  const sumFee = ra.allocated_fixed_fee + rb.allocated_fixed_fee;
  ok(cents(sumFee, 0.25), `Σ fixe ligne = fixe commande 0.25 (${eur(sumFee)})`);
  // parts attendues : revenus 90 et 30 → 0.1875 / 0.0625
  ok(cents(ra.allocated_fixed_fee, 0.25 * 90 / 120) && cents(rb.allocated_fixed_fee, 0.25 * 30 / 120),
     `prorata correct (${eur(ra.allocated_fixed_fee)} / ${eur(rb.allocated_fixed_fee)})`);

  // line_net_margin intègre le fixe : ancre indépendante
  const ua = anchorUnitMargin("V2", 45, created), ub = anchorUnitMargin("V3", 30, created);
  ok(cents(ra.line_net_margin, ua * 2 - 0.25 * 90 / 120), `L2a line_net_margin AU CENTIME (${eur(ra.line_net_margin)})`);
  ok(cents(rb.line_net_margin, ub * 1 - 0.25 * 30 / 120), `L2b line_net_margin AU CENTIME (${eur(rb.line_net_margin)})`);
}

// ── F3 : remboursement partiel, transaction REFUND/SUCCESS → effective_qty partiel ──
console.log("\n── F3 : refund partiel settled ──");
{
  const created = "2026-06-14T09:00:00Z";
  const txt = jsonl([
    { kind: "REFUND", status: "SUCCESS", __parentId: "R3", __typename: "OrderTransaction", amountSet: mb("600.00") },
    { lineItem: { id: "L3" }, quantity: 1, __parentId: "R3", __typename: "RefundLineItem" },
    { id: "R3", __parentId: "O3", __typename: "Refund" },
    { id: "L3", __parentId: "O3", __typename: "LineItem", quantity: 3, variant: { id: "V1" }, product: { id: "P1" },
      originalUnitPriceSet: mb("600.00"), discountedUnitPriceAfterAllDiscountsSet: mb("600.00"), discountAllocations: [] },
    { id: "O3", createdAt: created, currencyCode: "USD" },
  ]);
  const [order] = parseBulkJsonl(txt);
  const rows = buildOrderHistoryRows(order, lookup, SHOP);
  const r = rows[0];
  ok(r.refunded_qty === 1 && r.effective_qty === 2, `refund settled → refunded 1, effective 2 (${r.refunded_qty}/${r.effective_qty})`);
  const unit = anchorUnitMargin("V1", 600, created);
  ok(cents(r.line_net_margin, unit * 2 - 0.25), `line_net_margin sur 2 unités effectives AU CENTIME (${eur(r.line_net_margin)})`);
}

// ── F4 : refund SANS transaction SUCCESS → 0 décompté (gating D4) ──
console.log("\n── F4 : refund non settled → ignoré ──");
{
  const txt = jsonl([
    { kind: "REFUND", status: "PENDING", __parentId: "R4", __typename: "OrderTransaction", amountSet: mb("600.00") },
    { lineItem: { id: "L4" }, quantity: 1, __parentId: "R4", __typename: "RefundLineItem" },
    { id: "R4", __parentId: "O4", __typename: "Refund" },
    { id: "L4", __parentId: "O4", __typename: "LineItem", quantity: 3, variant: { id: "V1" }, product: { id: "P1" },
      originalUnitPriceSet: mb("600.00"), discountedUnitPriceAfterAllDiscountsSet: mb("600.00"), discountAllocations: [] },
    { id: "O4", createdAt: "2026-06-15T09:00:00Z", currencyCode: "USD" },
  ]);
  const [order] = parseBulkJsonl(txt);
  const r = buildOrderHistoryRows(order, lookup, SHOP)[0];
  ok(r.refunded_qty === 0 && r.effective_qty === 3, `refund PENDING ignoré → effective 3 (${r.effective_qty})`);
}

// ── F5 : coûts manquants → cost_source='missing', marges null ──
console.log("\n── F5 : coûts manquants ──");
{
  const txt = jsonl([
    { id: "L5", __parentId: "O5", __typename: "LineItem", quantity: 2, variant: { id: "V99" }, product: { id: "P9" },
      originalUnitPriceSet: mb("40.00"), discountedUnitPriceAfterAllDiscountsSet: mb("40.00"), discountAllocations: [] },
    { id: "O5", createdAt: "2026-06-16T09:00:00Z", currencyCode: "USD" },
  ]);
  const [order] = parseBulkJsonl(txt);
  const r = buildOrderHistoryRows(order, lookup, SHOP)[0];
  ok(r.cost_source === "missing", "cost_source = missing");
  ok(r.unit_net_margin === null && r.line_net_margin === null && r.net_unit_revenue === null, "marges/revenu null (jamais de marge fausse)");
  ok(r.allocated_fixed_fee === null, "fixe non imputé sur ligne missing");
}

// ── F6 : AfterAll null → fallback D1 déclenché ──
console.log("\n── F6 : fallback D1 (AfterAll null) ──");
{
  let fallbackHit = 0;
  const line = { quantity: 2, originalUnitPriceSet: mb("50.00"),
    discountedUnitPriceAfterAllDiscountsSet: mb(null), discountAllocations: [{ allocatedAmountSet: mb("10.00") }] };
  const net = netUnitRevenue(line, { onFallback: () => fallbackHit++ });
  ok(fallbackHit === 1, "fallback déclenché quand AfterAll null");
  ok(cents(net, 50 - 10 / 2), `fallback = original − Σalloc/qty = 45 (${eur(net)})`);
  // sanity : champ présent → pas de fallback, AfterAll seul
  let hit2 = 0;
  const net2 = netUnitRevenue({ quantity: 2, discountedUnitPriceAfterAllDiscountsSet: mb("45.00"),
    originalUnitPriceSet: mb("50.00"), discountAllocations: [{ allocatedAmountSet: mb("10.00") }] }, { onFallback: () => hit2++ });
  ok(hit2 === 0 && cents(net2, 45), "AfterAll présent → 45, pas de fallback, pas d'ajout d'alloc");
}

// ── Re-stitch : ordre JSONL inversé reconstruit correctement ──
console.log("\n── Re-stitch (ordre inversé) ──");
{
  const txt = jsonl([
    { kind: "REFUND", status: "SUCCESS", __parentId: "Rx", __typename: "OrderTransaction", amountSet: mb("1.00") },
    { lineItem: { id: "Lx" }, quantity: 1, __parentId: "Rx", __typename: "RefundLineItem" },
    { id: "Rx", __parentId: "Ox", __typename: "Refund" },
    { id: "Lx", __parentId: "Ox", __typename: "LineItem", quantity: 5, variant: { id: "V1" } },
    { id: "Ox", createdAt: "2026-06-17T00:00:00Z", currencyCode: "USD" },
  ]);
  const [o] = parseBulkJsonl(txt);
  ok(o.id === "Ox" && o.lineItems.length === 1 && o.lineItems[0].id === "Lx", "order ← lineItem re-stitché");
  ok(o.refunds.length === 1 && o.refunds[0].refundLineItems.length === 1 && o.refunds[0].transactions.length === 1,
     "refund ← refundLineItems + transactions re-stitchés");
  ok(effectiveRefundedQty(o.refunds, "Lx") === 1, "effectiveRefundedQty lit l'arbre re-stitché");
}

// ── Idempotence (pur) : même fixture 2× → lignes déterministes, clé stable ──
console.log("\n── Idempotence ──");
{
  const created = "2026-06-10T10:00:00Z";
  const txt = jsonl([
    { id: "L1", __parentId: "O1", __typename: "LineItem", quantity: 3, variant: { id: "V1" }, product: { id: "P1" },
      originalUnitPriceSet: mb("600.00"), discountedUnitPriceAfterAllDiscountsSet: mb("600.00"), discountAllocations: [] },
    { id: "O1", createdAt: created, currencyCode: "USD" },
  ]);
  const r1 = buildOrderHistoryRows(parseBulkJsonl(txt)[0], lookup, SHOP)[0];
  const r2 = buildOrderHistoryRows(parseBulkJsonl(txt)[0], lookup, SHOP)[0];
  const key = (r) => `${r.order_id}|${r.line_item_id}`;
  ok(key(r1) === key(r2), "clé (order_id|line_item_id) stable");
  ok(JSON.stringify(r1) === JSON.stringify(r2), "deux ingestions → ligne identique (snapshot figé, zéro diff)");
}

// ── Clamp : Σ refunds > quantity → effective_qty 0, jamais négatif ──
console.log("\n── Clamp effective_qty ≥ 0 ──");
{
  const txt = jsonl([
    { kind: "REFUND", status: "SUCCESS", __parentId: "Rc", __typename: "OrderTransaction", amountSet: mb("1.00") },
    { lineItem: { id: "Lc" }, quantity: 5, __parentId: "Rc", __typename: "RefundLineItem" }, // 5 > qty 3
    { id: "Rc", __parentId: "Oc", __typename: "Refund" },
    { id: "Lc", __parentId: "Oc", __typename: "LineItem", quantity: 3, variant: { id: "V1" }, product: { id: "P1" },
      originalUnitPriceSet: mb("600.00"), discountedUnitPriceAfterAllDiscountsSet: mb("600.00"), discountAllocations: [] },
    { id: "Oc", createdAt: "2026-06-18T00:00:00Z", currencyCode: "USD" },
  ]);
  const r = buildOrderHistoryRows(parseBulkJsonl(txt)[0], lookup, SHOP)[0];
  ok(r.effective_qty === 0, `effective_qty clampé à 0 (${r.effective_qty})`);
  ok(cents(r.line_net_revenue, 0) && cents(r.line_net_margin, 0), "revenu 0 et marge 0 (fixe prorata 0 car Σrevenu=0)");
}

// ── C4a : countDistinctOrders — lignes insérées → commandes distinctes (PUR, base du plafond) ──
console.log("\n── C4a : countDistinctOrders ──");
{
  ok(countDistinctOrders([]) === 0, "tableau vide → 0");
  ok(countDistinctOrders(null) === 0, "null → 0 (pas de crash)");
  ok(countDistinctOrders(undefined) === 0, "undefined → 0 (pas de crash)");
  ok(countDistinctOrders("nope") === 0, "non-tableau → 0");
  ok(countDistinctOrders([{ order_id: "A" }, { order_id: "A" }, { order_id: "A" }]) === 1, "3 lignes MÊME order_id → 1 commande (dédup)");
  ok(countDistinctOrders([{ order_id: "A" }, { order_id: "B" }, { order_id: "C" }]) === 3, "3 lignes 3 order_id → 3 commandes");
  ok(countDistinctOrders([{ order_id: "A" }, { order_id: "A" }, { order_id: "B" }]) === 2, "mélange (A,A,B) → 2 commandes distinctes");
  ok(countDistinctOrders([{ order_id: "A" }, { order_id: null }, { order_id: "" }, {}, { order_id: "B" }]) === 2, "order_id null/vide/absent IGNORÉ → 2 (A,B) — jamais de sur-comptage");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 6 (ingestion commandes) : ✓ Tous les tests passent"
  : ` BILAN LOT 6 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
