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

// ════════════════════════════════════════════════════════════════════════════════
//  SEUIL DE RENTABILITÉ CONFIGURABLE — 3e param thresholdPct (défaut 0).
//  Frontière : sous le seuil ⟺ net_margin < (T/100) × net_revenue. Pure comparaison.
// ════════════════════════════════════════════════════════════════════════════════

// Fabrique une entrée byProduct AVEC CA (net_revenue) → nécessaire pour le seuil %.
const prodR = (o) => ({ product_id: o.id, net_margin: o.margin, net_revenue: o.rev,
  marginPct: o.rev > 0 ? (o.margin / o.rev) * 100 : null, currency: o.cur ?? "USD" });

// ── au-dessus du seuil : reste profitable, aucune alerte ──
console.log("\n── seuil 15 % : marge 20 % > seuil → profitable ──");
{
  const r = computeProfitabilityChanges([prodR({ id: "P", margin: 20, rev: 100 })], stateMap([["P", "profitable"]]), 15);
  ok(r.basculements.length === 0 && r.majNormales.length === 1, "aucun basculement (20 % ≥ 15 %)");
  ok(r.majNormales[0].state === "profitable", "état profitable conservé");
}

// ── sous le seuil mais marge > 0 : bascule loss (le cœur de la feature) ──
console.log("\n── seuil 15 % : marge 8 % (>0) < seuil → bascule loss ──");
{
  const r = computeProfitabilityChanges([prodR({ id: "P", margin: 8, rev: 100 })], stateMap([["P", "profitable"]]), 15);
  ok(r.basculements.length === 1 && r.basculements[0].to === "loss", "bascule profitable → loss bien que marge > 0");
  ok(r.basculements[0].margin === 8 && Math.round(r.basculements[0].marginPct) === 8, "margin + marginPct portés (pour le mail)");
}

// ── marge négative : loss quel que soit le seuil ──
console.log("\n── seuil 15 % : marge < 0 → loss ──");
{
  const r = computeProfitabilityChanges([prodR({ id: "P", margin: -3, rev: 50 })], stateMap([["P", "profitable"]]), 15);
  ok(r.basculements.length === 1 && r.basculements[0].to === "loss", "marge négative → loss");
}

// ── frontière STRICTE : marge == seuil exact → au-dessus (pas sous) ──
console.log("\n── frontière stricte : marge == (T/100)×CA ──");
{
  const r = computeProfitabilityChanges([prodR({ id: "P", margin: 15, rev: 100 })], stateMap([["P", "loss"]]), 15);
  ok(r.basculements.length === 1 && r.basculements[0].to === "profitable", "marge = 15 % pile = seuil → profitable (comparaison stricte <)");
}

// ── CA = 0 & marge < 0 à seuil > 0 : loss, AUCUNE division par zéro ──
console.log("\n── CA = 0 & marge < 0, seuil 15 % → loss (pas de /0) ──");
{
  const r = computeProfitabilityChanges([prodR({ id: "P", margin: -2, rev: 0 })], stateMap([["P", "profitable"]]), 15);
  ok(r.basculements.length === 1 && r.basculements[0].to === "loss", "CA=0 & marge<0 → loss");
  ok(r.basculements[0].marginPct === null, "marginPct null quand CA=0 (jamais NaN/Infinity)");
}

// ════════════════════════════════════════════════════════════════════════════════
//  PREUVE NON-RÉGRESSION : thresholdPct = 0 reproduit EXACTEMENT la perte stricte.
// ════════════════════════════════════════════════════════════════════════════════
console.log("\n── NON-RÉGRESSION : seuil = 0 == perte stricte legacy ──");
{
  // À T=0, une marge faiblement positive (8 %) reste profitable — alors qu'à T=15 elle bascule.
  const r = computeProfitabilityChanges([prodR({ id: "P", margin: 8, rev: 100 })], stateMap([["P", "profitable"]]), 0);
  ok(r.basculements.length === 0 && r.majNormales[0].state === "profitable", "seuil 0 : marge 8 % reste profitable (perte STRICTE)");

  // Le paramètre par défaut (absent) DOIT être identique à thresholdPct=0 explicite.
  const cur = [prod({ id: "X", margin: -5 }), prod({ id: "Y", margin: 7 })];
  const prev = stateMap([["X", "profitable"], ["Y", "profitable"]]);
  const parDefaut = computeProfitabilityChanges(cur, prev);          // legacy (2 args)
  const explicite = computeProfitabilityChanges(cur, prev, 0);        // seuil 0 explicite
  ok(JSON.stringify(parDefaut) === JSON.stringify(explicite), "param par défaut ≡ thresholdPct=0 (bit pour bit)");
  ok(parDefaut.basculements.length === 1 && parDefaut.basculements[0].product_id === "X" && parDefaut.basculements[0].to === "loss",
    "comportement legacy intact (X rentable→perte, Y inchangé)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 9 (alerting diff état) : ✓ Tous les tests passent"
  : ` BILAN LOT 9 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
