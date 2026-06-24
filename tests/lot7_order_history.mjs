// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU UI Monitor — agrégats d'historique (app/lib/orderHistory.js, PUR)
//  Asserts sur les SORTIES de la fonction pure (pas le rendu). Aucune marge recalculée :
//  uniquement regroupements + sommes des colonnes order_margins stockées.
//  Pour lancer : node tests/lot7_order_history.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { aggregateOrderMargins } from "../app/lib/orderHistory.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// Fabrique une ligne order_margins (valeurs déjà calculées par engine.js à l'ingestion).
const row = (o) => ({
  shop_domain: "s", order_id: o.order, line_item_id: o.line ?? o.order + "-L",
  product_id: o.product ?? null, order_created_at: o.day ?? "2026-06-10T10:00:00Z",
  effective_qty: o.qty ?? 1, line_net_revenue: o.rev ?? 0, line_net_margin: o.margin ?? 0,
  cost_source: o.source ?? "confirmed", currency_code: o.cur ?? "USD",
});

// ── [A] Rentable globalement malgré 1 commande à perte → PAS marqué non rentable ──
console.log("\n── [A] agrégat par produit (1 commande à perte n'invalide pas le produit) ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O1", product: "P1", rev: 100, margin: 40 }),
    row({ order: "O2", product: "P1", rev: 100, margin: -10 }), // commande à perte
    row({ order: "O3", product: "P1", rev: 100, margin: 30 }),
  ]);
  const p1 = a.byProduct.find(p => p.product_id === "P1");
  ok(p1.net_margin === 60, `Σ marge P1 = 60 (${p1.net_margin})`);
  ok(p1.orders === 3, `3 commandes distinctes (${p1.orders})`);
  ok(p1.unprofitable === false, "P1 NON marqué à perte (jugé par produit, pas par ligne)");
  ok(a.unprofitableCount === 0, "0 produit à perte");
}

// ── [A] Produit globalement à perte → marqué non rentable ──
console.log("\n── [A] produit globalement à perte ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O4", product: "P2", rev: 50, margin: -20 }),
    row({ order: "O5", product: "P2", rev: 50, margin: -5 }),
  ]);
  const p2 = a.byProduct.find(p => p.product_id === "P2");
  ok(p2.net_margin === -25 && p2.unprofitable === true, `P2 Σ marge -25 → à perte (${p2.net_margin})`);
  ok(a.unprofitableCount === 1 && a.unprofitableProducts[0].product_id === "P2", "compteur = 1 produit à perte");
}

// ── [C] cost_source='missing' → exclu des agrégats/byDay, présent dans missingCostRows ──
console.log("\n── [C] coûts manquants exclus des sommes ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O6", product: "P1", rev: 100, margin: 40 }),
    row({ order: "O7", product: "P3", source: "missing", margin: null, rev: null }),
  ]);
  ok(a.missingCount === 1, "1 ligne missing isolée");
  ok(!a.byProduct.some(p => p.product_id === "P3"), "P3 (missing) absent des agrégats");
  ok(a.byProduct.length === 1 && a.byProduct[0].product_id === "P1", "seul P1 agrégé");
  ok(a.totals.net_margin === 40, "Σ marge = 40 (missing non compté)");
}

// ── [B] 2 jours distincts → byDay a 2 entrées, sommes par jour ──
console.log("\n── [B] agrégat par jour (UTC) ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O8",  product: "P1", rev: 100, margin: 40, day: "2026-06-10T08:00:00Z" }),
    row({ order: "O9",  product: "P1", rev: 50,  margin: 10, day: "2026-06-10T20:00:00Z" }), // même jour
    row({ order: "O10", product: "P1", rev: 80,  margin: 20, day: "2026-06-11T09:00:00Z" }),
  ]);
  ok(a.byDay.length === 2, `2 jours (${a.byDay.length})`);
  const d10 = a.byDay.find(d => d.day === "2026-06-10");
  const d11 = a.byDay.find(d => d.day === "2026-06-11");
  ok(d10.net_revenue === 150 && d10.net_margin === 50, `10/06 : CA 150, marge 50 (${d10.net_revenue}/${d10.net_margin})`);
  ok(d11.net_revenue === 80 && d11.net_margin === 20, `11/06 : CA 80, marge 20`);
  ok(a.byDay[0].day < a.byDay[1].day, "byDay trié chronologiquement");
}

// ── [edge] effective_qty=0 (entièrement remboursé) → contribue 0, pas de perte fictive ──
console.log("\n── [edge] effective_qty=0 ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O11", product: "P4", qty: 0, rev: 0, margin: 0 }),
  ]);
  const p4 = a.byProduct.find(p => p.product_id === "P4");
  ok(p4.effective_qty === 0 && p4.net_margin === 0, "qty 0, marge 0");
  ok(p4.unprofitable === false, "marge 0 → PAS à perte (pas de perte inventée)");
}

// ── [edge] CA net = 0 → marginPct null (pas de division par zéro) ──
console.log("\n── [edge] CA net = 0 → % marge — ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O12", product: "P5", rev: 0, margin: 0 }),
  ]);
  ok(a.byProduct[0].marginPct === null, "marginPct null quand CA net = 0");
}

// ── [edge] product_id null → groupé sous clé neutre, pas de crash ──
console.log("\n── [edge] product_id null ──");
{
  const a = aggregateOrderMargins([ row({ order: "O13", product: null, rev: 10, margin: 5 }) ]);
  ok(a.byProduct.length === 1 && a.byProduct[0].product_id === null, "produit null regroupé sans crash");
}

// ── [LISTE] multi-devises → flag, jamais de somme à l'aveugle ──
console.log("\n── [LISTE] multi-devises signalé ──");
{
  const a = aggregateOrderMargins([
    row({ order: "O14", product: "P1", rev: 100, margin: 40, cur: "USD" }),
    row({ order: "O15", product: "P6", rev: 90,  margin: 30, cur: "EUR" }),
  ]);
  ok(a.multiCurrency === true && a.currencies.length === 2, `multiCurrency=true (${a.currencies.join(",")})`);
}

// ── [edge] vide → sorties vides propres, pas de crash ──
console.log("\n── [edge] entrée vide ──");
{
  const a = aggregateOrderMargins([]);
  ok(a.byProduct.length === 0 && a.byDay.length === 0 && a.unprofitableCount === 0 && a.missingCount === 0, "tout vide, aucun crash");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 7 (historique monitor) : ✓ Tous les tests passent"
  : ` BILAN LOT 7 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
