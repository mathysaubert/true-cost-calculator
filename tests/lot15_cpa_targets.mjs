// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU CPA prescriptif — dérivation PURE (app/lib/cpaTargets.js). AUCUNE marge
//  recalculée : on soustrait la réserve de seuil et on divise des agrégats serveur.
//  Réconcilié avec l'invariant lot3 : à seuil=0, marge dispo/unité == net_margin / qty
//  (= marge AVANT pub, car ads=0 à l'ingestion). engine.js intouché.
//  Pour lancer : node tests/lot15_cpa_targets.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { computeCpaTargets, availableForAds } from "../app/lib/cpaTargets.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const near = (a, b) => Math.abs(a - b) < 0.005; // au centime

// Fabrique un agg minimal (forme aggregateOrderMargins).
const P = (o) => ({ product_id: o.id, net_margin: o.m, net_revenue: o.r, effective_qty: o.q, currency: o.cur ?? "USD" });
const agg = (products, totals, opts = {}) => ({
  byProduct: products,
  totals: totals ?? { net_margin: 0, net_revenue: 0, orders: 0 },
  multiCurrency: opts.multiCurrency ?? false,
  currencies: opts.currencies ?? ["USD"],
});

// ── RÉCONCILIATION lot3 : seuil=0 → marge dispo/unité == net_margin / qty ──
console.log("\n── seuil=0 : marge dispo/unité = net_margin/qty (avant pub) ──");
{
  const r = computeCpaTargets(agg([P({ id: "A", m: 100, r: 400, q: 4 })]), { thresholdPct: 0 });
  ok(near(r.perProduct[0].margeDispoUnite, 25), "net_margin 100 / 4 unités = 25,00 (== net_margin/qty)");
  ok(r.perProduct[0].exhausted === false, "marge dispo > 0 → non épuisé");
  // availableForAds à seuil 0 = net_margin exactement.
  ok(near(availableForAds(100, 400, 0), 100), "availableForAds(seuil=0) == net_margin");
}

// ── SEUIL : réserve = (seuil/100)×CA soustraite avant division ──
console.log("\n── seuil 10 % : réserve retirée puis /qty ──");
{
  const r = computeCpaTargets(agg([P({ id: "A", m: 100, r: 200, q: 4 })]), { thresholdPct: 10 });
  // available = 100 − 0.10×200 = 80 ; /4 = 20
  ok(near(r.perProduct[0].margeDispoUnite, 20), "(100 − 10%×200)/4 = 20,00");
}

// ── DURCISSEMENT 2 : marge dispo/unité ≤ 0 → exhausted ──
console.log("\n── exhausted (aucune acquisition payante possible) ──");
{
  // Rentable (net_margin>0) mais SOUS le seuil → dispo négative → exhausted (distinct de 'à perte').
  const thin = computeCpaTargets(agg([P({ id: "A", m: 10, r: 200, q: 2 })]), { thresholdPct: 10 });
  ok(thin.perProduct[0].margeDispoUnite < 0 && thin.perProduct[0].exhausted === true, "marge>0 mais sous seuil → dispo<0, exhausted (≠ à perte)");
  // À perte pur (seuil 0) → exhausted aussi.
  const loss = computeCpaTargets(agg([P({ id: "A", m: -4, r: 50, q: 2 })]), { thresholdPct: 0 });
  ok(loss.perProduct[0].exhausted === true, "marge nette négative → exhausted");
  // Pile 0 → exhausted (≤ 0).
  const zero = computeCpaTargets(agg([P({ id: "A", m: 0, r: 50, q: 2 })]), { thresholdPct: 0 });
  ok(zero.perProduct[0].margeDispoUnite === 0 && zero.perProduct[0].exhausted === true, "dispo pile 0 → exhausted");
}

// ── GARDES : qty 0 (pas de /0) et devise MIXED (pas de somme cross-devise) ──
console.log("\n── qty=0 et MIXED → margeDispoUnite null ──");
{
  const r = computeCpaTargets(agg([
    P({ id: "Z", m: 50, r: 100, q: 0 }),
    { product_id: "M", net_margin: 30, net_revenue: 90, effective_qty: 3, currency: "MIXED" },
  ]), { thresholdPct: 0 });
  ok(r.perProduct[0].margeDispoUnite === null && r.perProduct[0].exhausted === false, "qty=0 → null, jamais exhausted par défaut");
  ok(r.perProduct[1].margeDispoUnite === null, "produit MIXED → null (pas de montant cross-devise)");
}

// ── BLENDED : vrai CPA max = (Σmarge − seuil×ΣCA) / commandes DISTINCTES ──
console.log("\n── blended : /totals.orders (commandes distinctes) ──");
{
  const a = agg(
    [P({ id: "A", m: 200, r: 500, q: 5 }), P({ id: "B", m: 100, r: 500, q: 20 })],
    { net_margin: 300, net_revenue: 1000, orders: 10 });
  const r0 = computeCpaTargets(a, { thresholdPct: 0 });
  ok(near(r0.blended.cpaMax, 30), "seuil 0 : 300/10 commandes = 30,00");
  ok(r0.blended.currency === "USD", "devise blended portée");
  const r15 = computeCpaTargets(a, { thresholdPct: 15 });
  ok(near(r15.blended.cpaMax, 15), "seuil 15 : (300 − 15%×1000)/10 = 15,00");
}

// ── BLENDED désactivé : multi-devises OU zéro commande ──
console.log("\n── blended null si multi-devises / zéro commande ──");
{
  const multi = computeCpaTargets(agg([P({ id: "A", m: 200, r: 500, q: 5 })],
    { net_margin: 200, net_revenue: 500, orders: 5 }, { multiCurrency: true, currencies: ["USD", "EUR"] }), {});
  ok(multi.blended === null, "multi-devises → blended null (jamais de somme cross-devise)");
  const noOrders = computeCpaTargets(agg([], { net_margin: 0, net_revenue: 0, orders: 0 }), {});
  ok(noOrders.blended === null, "zéro commande → blended null (pas de /0)");
}

// ── ÉCART vs CPA déclaré (durcissement 1) : marge de manœuvre / dépassement ──
console.log("\n── écart CPA max blended − CPA déclaré ──");
{
  const a = agg([P({ id: "A", m: 300, r: 1000, q: 10 })], { net_margin: 300, net_revenue: 1000, orders: 10 });
  const under = computeCpaTargets(a, { thresholdPct: 0, currentCpa: 20 }); // cpaMax=30
  ok(near(under.ecart.value, 10) && under.ecart.overspend === false, "CPA déclaré 20 < max 30 → marge de manœuvre +10");
  const over = computeCpaTargets(a, { thresholdPct: 0, currentCpa: 40 });
  ok(near(over.ecart.value, -10) && over.ecart.overspend === true, "CPA déclaré 40 > max 30 → dépassement −10");
  ok(computeCpaTargets(a, { thresholdPct: 0 }).ecart === null, "pas de CPA déclaré → écart null");
  const multi = computeCpaTargets(agg([], { net_margin: 0, net_revenue: 0, orders: 0 }, { multiCurrency: true }), { currentCpa: 20 });
  ok(multi.ecart === null, "pas de blended (multi-devises) → écart null même avec CPA déclaré");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 15 (CPA prescriptif) : ✓ Tous les tests passent"
  : ` BILAN LOT 15 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
