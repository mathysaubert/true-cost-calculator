// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU CPA prescriptif — dérivation PURE (app/lib/cpaTargets.js). AUCUNE marge
//  recalculée : on soustrait la réserve de seuil et on divise des agrégats serveur.
//  Réconcilié lot3 (seuil=0 → marge dispo/unité == net_margin/qty = marge AVANT pub).
//  VERROU machine à états : les 5 états sont couverts, et aucune entrée ne produit d'état
//  hors liste. engine.js intouché. Pour lancer : node tests/lot15_cpa_targets.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { computeCpaTargets, availableForAds, CPA_STALE_DAYS } from "../app/lib/cpaTargets.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const near = (a, b) => Math.abs(a - b) < 0.005; // au centime

const P = (o) => ({ product_id: o.id, net_margin: o.m, net_revenue: o.r, effective_qty: o.q, currency: o.cur ?? "USD" });
const agg = (products, totals, opts = {}) => ({
  byProduct: products,
  totals: totals ?? { net_margin: 0, net_revenue: 0, orders: 0 },
  multiCurrency: opts.multiCurrency ?? false,
  currencies: opts.currencies ?? ["USD"],
});
const state1 = (p, opts = {}) => computeCpaTargets(agg([p]), opts).perProduct[0];

// ── RÉCONCILIATION lot3 : seuil=0 → marge dispo/unité == net_margin/qty (avant pub) ──
console.log("\n── seuil=0 : marge dispo/unité = net_margin/qty ──");
{
  const r = state1(P({ id: "A", m: 100, r: 400, q: 4 }), { thresholdPct: 0 });
  ok(near(r.margeDispoUnite, 25) && r.state === "ok", "100/4 = 25,00, state 'ok'");
  ok(near(availableForAds(100, 400, 0), 100), "availableForAds(seuil=0) == net_margin");
}

// ── SEUIL : réserve (seuil/100)×CA retirée avant division ──
console.log("\n── seuil 10 % : réserve retirée ──");
ok(near(state1(P({ id: "A", m: 100, r: 200, q: 4 }), { thresholdPct: 10 }).margeDispoUnite, 20), "(100 − 10%×200)/4 = 20,00");

// ════════════════════════════════════════════════════════════════════════════════
//  VERROU — les 5 états, un cas nommé chacun, + aucune entrée hors liste.
// ════════════════════════════════════════════════════════════════════════════════
console.log("\n── machine à 5 états : un cas nommé chacun ──");
{
  ok(state1(P({ id: "A", m: 100, r: 400, q: 4 })).state === "ok", "ok : margeDispoUnite > 0");
  ok(state1(P({ id: "A", m: -8, r: 100, q: 2 })).state === "no_acquisition", "no_acquisition : margeDispoUnite < 0 (vend mais marge ≤ 0)");
  ok(state1(P({ id: "A", m: -0.5, r: 0, q: 0 })).state === "value_destroyed", "value_destroyed : qty=0 & net_margin<0 (remboursé à perte)");
  ok(state1(P({ id: "A", m: 0, r: 0, q: 0 })).state === "no_units", "no_units : qty=0 & net_margin≥0 (remboursement neutre)");
  ok(state1({ product_id: "M", net_margin: 30, net_revenue: 90, effective_qty: 3, currency: "MIXED" }).state === "mixed_currency", "mixed_currency : devise MIXED");
}

// ── CAS-LIMITE OBLIGATOIRE : net_margin EXACTEMENT = requiredProfit → availableUnit === 0 ──
console.log("\n── frontière : availableUnit == 0 → no_acquisition (verrou anti-refactor ≤/<) ──");
{
  // seuil 10 %, CA 200 → requiredProfit = 20 ; net_margin = 20 → available = 0 ; /5 = 0.
  const r = state1(P({ id: "A", m: 20, r: 200, q: 5 }), { thresholdPct: 10 });
  ok(r.margeDispoUnite === 0, "marge dispo/unité pile 0,00 (net_margin == requiredProfit)");
  ok(r.state === "no_acquisition", "0 € de budget = AUCUNE acquisition possible → no_acquisition (≤ 0, pas 'ok')");
}

// ── AUCUNE entrée ne produit un état hors des 5 prévus ──
console.log("\n── exhaustivité : aucun état inattendu ──");
{
  const ALLOWED = new Set(["ok", "no_acquisition", "value_destroyed", "no_units", "mixed_currency"]);
  const zoo = [
    P({ id: "a", m: 100, r: 400, q: 4 }), P({ id: "b", m: -8, r: 100, q: 2 }),
    P({ id: "c", m: -1, r: 0, q: 0 }), P({ id: "d", m: 5, r: 0, q: 0 }), P({ id: "e", m: 0, r: 0, q: 0 }),
    { product_id: "f", net_margin: 1, net_revenue: 2, effective_qty: 1, currency: "MIXED" },
    P({ id: "g", m: -3, r: 50, q: -2 }), // qty négative (remboursements > ventes)
    { product_id: null, net_margin: 4, net_revenue: 10, effective_qty: 1, currency: "USD" },
  ];
  for (const th of [0, 10, 50, 100]) {
    const r = computeCpaTargets(agg(zoo, { net_margin: 0, net_revenue: 0, orders: 3 }), { thresholdPct: th });
    ok(r.perProduct.every((x) => ALLOWED.has(x.state)), `seuil ${th}% : tous les états ∈ {5 prévus}`);
    ok(r.perProduct.every((x) => (x.margeDispoUnite == null) === !(x.state === "ok" || x.state === "no_acquisition")), `seuil ${th}% : montant ⇔ (ok|no_acquisition), null sinon`);
  }
}

// ── COMPTEURS séparés : noAcqCount vs valueDestroyedCount (point 2) ──
console.log("\n── compteurs inconditionnels : deux réalités, deux compteurs ──");
{
  const a = agg([
    P({ id: "A", m: -500, r: 1000, q: 5 }),   // no_acquisition
    P({ id: "B", m: 600, r: 1000, q: 10 }),   // ok
    P({ id: "C", m: -2, r: 0, q: 0 }),        // value_destroyed
    P({ id: "D", m: -3, r: 0, q: 0 }),        // value_destroyed
  ], { net_margin: 95, net_revenue: 2000, orders: 10 });
  const r = computeCpaTargets(a, { thresholdPct: 0 });
  ok(r.noAcqCount === 1, "noAcqCount = 1 (A) — ne compte QUE les no_acquisition");
  ok(r.valueDestroyedCount === 2, "valueDestroyedCount = 2 (C, D) — comptés à part, PAS dans noAcqCount");
  const clean = computeCpaTargets(agg([P({ id: "B", m: 600, r: 1000, q: 10 })], { net_margin: 600, net_revenue: 1000, orders: 10 }), {});
  ok(clean.noAcqCount === 0 && clean.valueDestroyedCount === 0, "catalogue sain → deux compteurs à 0 (aucune bannière)");
}

// ── A2 : CA=0 & qty>0 → seuil inopérant, no_acquisition quand même ──
console.log("\n── A2 : CA=0 & qty>0 → seuil inopérant, capté ──");
{
  const r = state1(P({ id: "X", m: -6, r: 0, q: 2 }), { thresholdPct: 50 });
  ok(near(r.margeDispoUnite, -3) && r.state === "no_acquisition", "requiredProfit=50%×0=0 (inopérant) ; −6/2=−3 → no_acquisition");
}

// ── A3 : mix A(−)/B(+) → blended positif TROMPEUR, A en no_acquisition ──
console.log("\n── A3 : blended positif mais A saigne ──");
{
  const a = agg([P({ id: "A", m: -500, r: 1000, q: 5 }), P({ id: "B", m: 600, r: 1000, q: 10 })],
    { net_margin: 100, net_revenue: 2000, orders: 10 });
  const r = computeCpaTargets(a, { thresholdPct: 0 });
  ok(near(r.blended.cpaMax, 10), "blended = 100/10 = 10,00 (positif, tentant)");
  ok(r.perProduct[0].state === "no_acquisition" && r.noAcqCount === 1, "A en no_acquisition, compté → bannière inconditionnelle");
}

// ── BLENDED : /commandes DISTINCTES, désactivé si multi-devises / zéro commande ──
console.log("\n── blended ──");
{
  const a = agg([P({ id: "A", m: 300, r: 1000, q: 10 })], { net_margin: 300, net_revenue: 1000, orders: 10 });
  ok(near(computeCpaTargets(a, { thresholdPct: 0 }).blended.cpaMax, 30), "300/10 = 30,00");
  ok(near(computeCpaTargets(a, { thresholdPct: 15 }).blended.cpaMax, 15), "(300 − 15%×1000)/10 = 15,00");
  ok(computeCpaTargets(agg([P({ id: "A", m: 200, r: 500, q: 5 })], { net_margin: 200, net_revenue: 500, orders: 5 }, { multiCurrency: true, currencies: ["USD", "EUR"] }), {}).blended === null, "multi-devises → null");
  ok(computeCpaTargets(agg([P({ id: "A", m: 50, r: 100, q: 2 })], { net_margin: 50, net_revenue: 100, orders: 0 }), {}).blended === null, "A6 : orders=0 → null (pas de NaN)");
}

// ── A7 : seuil 100 % → available ≤ 0 partout (logique, pas un bug) ──
console.log("\n── A7 : seuil 100 % → no_acquisition partout ──");
{
  const r = state1(P({ id: "A", m: 50, r: 200, q: 5 }), { thresholdPct: 100 });
  ok(near(r.margeDispoUnite, -30) && r.state === "no_acquisition", "(50 − 100%×200)/5 = −30 : conséquence logique d'un seuil absurde");
}

// ── ÉCART : gap SERVEUR (label + magnitude absolue), 0 vs null, dépassement ──
console.log("\n── écart : gapLabel/gapAmount serveur, 0 ≠ null ──");
{
  const a = agg([P({ id: "A", m: 300, r: 1000, q: 10 })], { net_margin: 300, net_revenue: 1000, orders: 10 }); // cpaMax=30
  const under = computeCpaTargets(a, { thresholdPct: 0, currentCpa: 20 });
  ok(under.ecart.gapLabel === "Marge de manœuvre" && near(under.ecart.gapAmount, 10) && under.ecart.overspend === false, "déclaré 20 < 30 → 'Marge de manœuvre' 10 (magnitude serveur)");
  const over = computeCpaTargets(a, { thresholdPct: 0, currentCpa: 45 });
  ok(over.ecart.gapLabel === "Dépassement" && near(over.ecart.gapAmount, 15) && over.ecart.overspend === true, "déclaré 45 > 30 → 'Dépassement' 15 (magnitude POSITIVE, aucun Math.abs client)");
  const zero = computeCpaTargets(a, { thresholdPct: 0, currentCpa: 0 });
  ok(zero.ecart !== null && near(zero.ecart.gapAmount, 30), "A4 : currentCpa=0 (déclaré) → écart plein (30)");
  ok(computeCpaTargets(a, { thresholdPct: 0, currentCpa: null }).ecart === null, "A4 : currentCpa=null (jamais saisi) → écart null (l'action DOIT mapper '' → null)");
}

// ── OBSOLESCENCE : ecart.stale (point 2) ──
console.log("\n── écart.stale : fraîcheur du CPA déclaré ──");
{
  const NOW = Date.parse("2026-07-12T12:00:00Z");
  const a = agg([P({ id: "A", m: 300, r: 1000, q: 10 })], { net_margin: 300, net_revenue: 1000, orders: 10 });
  const mk = (daysOld, dateNull = false) => computeCpaTargets(a, { thresholdPct: 0, currentCpa: 20, now: NOW,
    currentCpaUpdatedAt: dateNull ? null : new Date(NOW - daysOld * 86400000).toISOString() });
  ok(mk(5).ecart.stale === false, "déclaré il y a 5 j (< 30) → frais");
  ok(mk(40).ecart.stale === true, "déclaré il y a 40 j (≥ 30) → stale (grisé)");
  ok(mk(CPA_STALE_DAYS).ecart.stale === true, `pile ${CPA_STALE_DAYS} j → stale (≥)`);
  ok(mk(0, true).ecart.stale === true, "date absente → stale (fraîcheur invérifiable)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 15 (CPA prescriptif) : ✓ Tous les tests passent"
  : ` BILAN LOT 15 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
