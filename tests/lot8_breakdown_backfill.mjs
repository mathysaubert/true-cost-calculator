// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Brique B (persistance) — margin_breakdown_json (app/lib/orderIngest.js)
//  On fige la sortie computeMargin à l'ingestion et on la rejoue (auto-validé) au
//  backfill. Preuve au centime : Σ(postes du breakdown) = unit_net_margin STOCKÉ.
//  engine.js intouché (on LIT son retour, on ne le réécrit pas).
//  Pour lancer : node tests/lot8_breakdown_backfill.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  parseBulkJsonl, buildOrderHistoryRows,
  buildMarginBreakdown, engineInputFromSnapshot, backfillRowBreakdown,
} from "../app/lib/orderIngest.js";

let failures = 0;
const ok    = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const f2    = (n) => (n == null ? "null" : Number(n).toFixed(2));
const cents = (a, b) => f2(a) === f2(b);

// Identité de réconciliation du waterfall PAR UNITÉ (cf. engine.js margeNette) :
const recon = (bd) =>
  bd.revenu - bd.coutRendu - bd.shopifyCost - bd.stripeCost - bd.retoursCost - bd.adsCost - bd.fraisFixes;

const mb = (amount) => ({ shopMoney: { amount } });
const jsonl = (objs) => objs.map((o) => JSON.stringify(o)).join("\n");

const SHOP_US = { shopTaxesIncluded: false, shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25 }; // store US (#1001)
const SHOP_FR = { shopTaxesIncluded: true,  shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25 }; // boutique FR B2C
const COSTS = {
  Vsnow: { prix_achat: 204.038095238, port_entrant: 0, qty_par_lot: 1, cout_emballage: 0, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Sport", source: "confirmed" },
  Vfr:   { prix_achat: 12, port_entrant: 3, qty_par_lot: 1, cout_emballage: 0.5, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Textile", source: "estimated" },
};
const lookup = (vid) => COSTS[vid] ?? null;

const oneLineOrder = (vid, price, created, oid = "O1", lid = "L1") =>
  parseBulkJsonl(jsonl([
    { id: lid, __parentId: oid, __typename: "LineItem", quantity: 1, variant: { id: vid }, product: { id: "P-" + vid },
      originalUnitPriceSet: mb(price), discountedUnitPriceAfterAllDiscountsSet: mb(price), discountAllocations: [] },
    { id: oid, createdAt: created, currencyCode: "USD" },
  ]))[0];

// ── REF #1001 (chiffres exacts, m construit à la main) : Σ postes = 364,76 ──
console.log("\n── REF #1001 : Σ postes = unit_net_margin 364,76 ──");
{
  // 600 TTC (store US → = HT) − 214,24 coutRendu − 12 Shopify − 9 Stripe = 364,76.
  const mRef = { revenu: 600, coutRendu: 214.24, douane: 9.97, tvaImport: 0, tvaNetCost: 0,
    shopifyCost: 12, stripeCost: 9, retoursCost: 0, adsCost: 0, fraisFixes: 0, customsRate: 0.05, vatRate: 0.20 };
  const bd = buildMarginBreakdown(mRef, SHOP_US.shopTaxesIncluded);
  ok(cents(recon(bd), 364.76), `Σ postes = 364,76 (${f2(recon(bd))})`);
  ok(bd.shop_taxes_included === false, "store US → shop_taxes_included = false (pas de TVA collectée)");
  ok("douane" in bd && "tvaImport" in bd, "douane/tvaImport exposés séparément dans le JSON");
}

// ── NATIF : ingestion peuple margin_breakdown_json, Σ = unit_net_margin au centime ──
console.log("\n── NATIF : breakdown figé à l'ingestion, réconcilie ──");
{
  const created = "2026-06-20T10:00:00Z";
  const row = buildOrderHistoryRows(oneLineOrder("Vsnow", "600.00", created), lookup, SHOP_US)[0];
  ok(row.margin_breakdown_json != null, "margin_breakdown_json peuplé nativement");
  ok(cents(recon(row.margin_breakdown_json), row.unit_net_margin),
     `Σ postes = unit_net_margin stocké (${f2(recon(row.margin_breakdown_json))} = ${f2(row.unit_net_margin)})`);
  ok(cents(row.unit_net_margin, 364.76), `total #1001 reproduit = 364,76 (${f2(row.unit_net_margin)})`);
  ok(row.margin_breakdown_json.shop_taxes_included === false, "shop_taxes_included false figé (store US)");
}

// ── NATIF FR : assujetti + taxesIncluded → revenu HT < prixVente, flag true ──
console.log("\n── NATIF FR : shop_taxes_included true, revenu HT ──");
{
  const row = buildOrderHistoryRows(oneLineOrder("Vfr", "60.00", "2026-06-21T10:00:00Z"), lookup, SHOP_FR)[0];
  const bd = row.margin_breakdown_json;
  ok(bd.shop_taxes_included === true, "shop_taxes_included = true figé (boutique FR TTC)");
  ok(bd.revenu < 60, `revenu = HT < 60 TTC (${f2(bd.revenu)}) — TVA collectée hors marge`);
  ok(cents(recon(bd), row.unit_net_margin), `Σ postes = unit_net_margin (${f2(recon(bd))} = ${f2(row.unit_net_margin)})`);
}

// ── COÛTS MANQUANTS : pas de breakdown (jamais de marge fausse) ──
console.log("\n── MISSING : pas de breakdown ──");
{
  const row = buildOrderHistoryRows(oneLineOrder("Vinconnu", "40.00", "2026-06-22T10:00:00Z"), lookup, SHOP_US)[0];
  ok(row.cost_source === "missing" && row.margin_breakdown_json === null, "ligne missing → margin_breakdown_json null");
}

// ── RE-RUN OK : ligne stockée rejouée (mêmes réglages) → écrit, réconcilie ──
console.log("\n── RE-RUN auto-validant : OK quand rien n'a dérivé ──");
{
  const created = "2026-06-20T10:00:00Z";
  const native = buildOrderHistoryRows(oneLineOrder("Vsnow", "600.00", created), lookup, SHOP_US)[0];
  // Forme "ligne stockée" telle que lue par l'action backfill_breakdowns (sans le JSON).
  const stored = {
    id: "row-1", net_unit_revenue: native.net_unit_revenue, unit_net_margin: native.unit_net_margin,
    order_created_at: native.order_created_at, cost_source: native.cost_source, cost_snapshot_json: native.cost_snapshot_json,
  };
  const before = JSON.stringify(stored);
  const res = backfillRowBreakdown(stored, SHOP_US);
  ok(res.ok === true, "re-run OK (réglages inchangés)");
  ok(cents(recon(res.breakdown), stored.unit_net_margin),
     `breakdown rejoué réconcilie au unit_net_margin stocké (${f2(recon(res.breakdown))} = ${f2(stored.unit_net_margin)})`);
  ok(JSON.stringify(stored) === before, "ligne d'entrée NON mutée (lecture pure)");
}

// ── RE-RUN SKIP : un taux a dérivé depuis l'ingestion → mismatch, champ reste null ──
console.log("\n── RE-RUN auto-validant : SKIP quand un taux a dérivé ──");
{
  const created = "2026-06-20T10:00:00Z";
  const native = buildOrderHistoryRows(oneLineOrder("Vsnow", "600.00", created), lookup, SHOP_US)[0];
  const stored = {
    id: "row-2", net_unit_revenue: native.net_unit_revenue, unit_net_margin: native.unit_net_margin,
    order_created_at: native.order_created_at, cost_source: native.cost_source, cost_snapshot_json: native.cost_snapshot_json,
  };
  const drifted = { ...SHOP_US, shopifyFee: 5 }; // 2% → 5% : Shopify cost change → ne réconcilie plus
  const res = backfillRowBreakdown(stored, drifted);
  ok(res.ok === false && res.reason === "reconcile_mismatch", `SKIP reconcile_mismatch (rejoué ${f2(res.replayed)} ≠ stocké ${f2(res.stored)})`);
}

// ── RE-RUN no_snapshot : ligne missing → rien à rejouer ──
console.log("\n── RE-RUN : ligne sans coût figé → no_snapshot ──");
{
  const res = backfillRowBreakdown({ id: "x", cost_source: "missing", unit_net_margin: null, cost_snapshot_json: null }, SHOP_US);
  ok(res.ok === false && res.reason === "no_snapshot", "no_snapshot (rien à rejouer)");
}

// ── DÉTERMINISME (idempotence pure) : 2 re-runs OK → breakdown identique ──
console.log("\n── Déterminisme du re-run ──");
{
  const native = buildOrderHistoryRows(oneLineOrder("Vsnow", "600.00", "2026-06-20T10:00:00Z"), lookup, SHOP_US)[0];
  const stored = { id: "row-3", net_unit_revenue: native.net_unit_revenue, unit_net_margin: native.unit_net_margin,
    order_created_at: native.order_created_at, cost_source: native.cost_source, cost_snapshot_json: native.cost_snapshot_json };
  const a = backfillRowBreakdown(stored, SHOP_US);
  const b = backfillRowBreakdown(stored, SHOP_US);
  ok(JSON.stringify(a.breakdown) === JSON.stringify(b.breakdown), "deux re-runs → breakdown identique (déterministe)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 8 (persistance breakdown) : ✓ Tous les tests passent"
  : ` BILAN LOT 8 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
