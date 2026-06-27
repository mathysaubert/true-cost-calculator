// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Alerting produit-à-perte — diff d'état PUR (app/lib/profitabilityAlert.js)
//  Asserts sur les 3 listes (basculements / seeds / majNormales). Aucun I/O, aucune marge
//  recalculée : on lit le signe de net_margin déjà agrégé. engine.js intouché.
//  Pour lancer : node tests/lot9_profitability_alert.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { computeProfitabilityChanges } from "../app/lib/profitabilityAlert.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// Fabrique une entrée byProduct (sortie aggregateOrderMargins).
const prod = (o) => ({ product_id: o.id, net_margin: o.margin, unprofitable: o.margin < 0, currency: o.cur ?? "USD" });
const stateMap = (pairs) => new Map(pairs.map(([id, st]) => [id, { last_state: st }]));

// ── rentable → perte : basculement détecté ──
console.log("\n── rentable → perte ──");
{
  const r = computeProfitabilityChanges([prod({ id: "P1", margin: -5 })], stateMap([["P1", "profitable"]]));
  ok(r.basculements.length === 1, "1 basculement");
  ok(r.basculements[0].from === "profitable" && r.basculements[0].to === "loss", "from profitable → to loss");
  ok(r.basculements[0].product_id === "P1" && r.basculements[0].margin === -5, "product_id + margin portés");
  ok(r.seeds.length === 0 && r.majNormales.length === 0, "ni seed ni maj");
}

// ── perte → rentable : basculement détecté (les deux sens) ──
console.log("\n── perte → rentable ──");
{
  const r = computeProfitabilityChanges([prod({ id: "P2", margin: 8 })], stateMap([["P2", "loss"]]));
  ok(r.basculements.length === 1 && r.basculements[0].from === "loss" && r.basculements[0].to === "profitable", "loss → profitable");
}

// ── état inchangé → majNormales, jamais d'alerte ──
console.log("\n── inchangé (les deux signes) ──");
{
  const r = computeProfitabilityChanges(
    [prod({ id: "P3", margin: 10 }), prod({ id: "P4", margin: -3 })],
    stateMap([["P3", "profitable"], ["P4", "loss"]]));
  ok(r.basculements.length === 0, "aucun basculement");
  ok(r.majNormales.length === 2, "2 maj normales");
  ok(r.seeds.length === 0, "aucun seed");
}

// ── nouveau produit (pas d'état antérieur) → seed, pas d'alerte ──
console.log("\n── nouveau produit → seed silencieux ──");
{
  const r = computeProfitabilityChanges([prod({ id: "P5", margin: -2 })], stateMap([["AUTRE", "profitable"]]));
  ok(r.seeds.length === 1 && r.seeds[0].product_id === "P5" && r.seeds[0].state === "loss", "P5 en seed (state loss)");
  ok(r.basculements.length === 0, "pas d'alerte sur un produit jamais vu");
}

// ── premier passage (state vide) → tout en seed, zéro basculement ──
console.log("\n── premier passage : prevStateMap vide ──");
{
  const r = computeProfitabilityChanges(
    [prod({ id: "P6", margin: 5 }), prod({ id: "P7", margin: -1 })], new Map());
  ok(r.seeds.length === 2 && r.basculements.length === 0, "tous seedés, aucun mail au premier run");
  ok(r.seeds.some(s => s.product_id === "P7") && r.seeds.every(s => s.id === undefined), "seeds portent product_id (pas id brut)");
}

// ── exclusion MIXED : jamais suivi, même s'il bascule ──
console.log("\n── exclusion multi-devises (MIXED) ──");
{
  const r = computeProfitabilityChanges(
    [{ product_id: "P8", net_margin: -9, unprofitable: true, currency: "MIXED" }],
    stateMap([["P8", "profitable"]]));
  ok(r.basculements.length === 0 && r.seeds.length === 0 && r.majNormales.length === 0, "produit MIXED absent des 3 listes");
}

// ── exclusion product_id null (produit supprimé) → non stockable ──
console.log("\n── exclusion product_id null ──");
{
  const r = computeProfitabilityChanges(
    [{ product_id: null, net_margin: -4, unprofitable: true, currency: "USD" }], new Map());
  ok(r.seeds.length === 0 && r.basculements.length === 0 && r.majNormales.length === 0, "product_id null ignoré");
}

// ── mélange réaliste : 1 bascule, 1 inchangé, 1 nouveau, 1 MIXED ──
console.log("\n── mélange réaliste ──");
{
  const r = computeProfitabilityChanges(
    [prod({ id: "A", margin: -1 }), prod({ id: "B", margin: 7 }), prod({ id: "C", margin: 3 }),
     { product_id: "D", net_margin: -2, unprofitable: true, currency: "MIXED" }],
    stateMap([["A", "profitable"], ["B", "profitable"]]));
  ok(r.basculements.length === 1 && r.basculements[0].product_id === "A", "A bascule (rentable→perte)");
  ok(r.majNormales.length === 1 && r.majNormales[0].product_id === "B", "B inchangé");
  ok(r.seeds.length === 1 && r.seeds[0].product_id === "C", "C seedé (nouveau)");
  ok(!r.basculements.concat(r.seeds, r.majNormales).some(x => x.product_id === "D"), "D (MIXED) exclu partout");
}

// ── produit suivi mais ABSENT de current (sorti de la fenêtre) → rien, surtout pas d'alerte ──
// La fonction itère sur current → un produit absent n'est jamais visité. Verrou anti-refacto :
// pas de fausse alerte "redevenu rentable" pour un produit qui a juste quitté la fenêtre.
console.log("\n── produit absent de current (état stocké conservé, zéro alerte) ──");
{
  const r = computeProfitabilityChanges([], stateMap([["P_loss", "loss"]]));
  ok(r.basculements.length === 0, "aucun basculement (pas de fausse alerte rentable)");
  ok(r.seeds.length === 0 && r.majNormales.length === 0, "ni seed ni maj — l'état stocké est laissé tel quel par l'appelant");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 9 (alerting diff état) : ✓ Tous les tests passent"
  : ` BILAN LOT 9 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
