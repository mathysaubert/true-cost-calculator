// ════════════════════════════════════════════════════════════════════════════════
//  Recalcul des marges historiques — DÉCISIONS PURES (Brique 1, fondation)
//  Verrouille : (1) quelle origine de coût est recalculable (défaut IMMUABLE sûr) ;
//  (2) quelles lignes supprimer (recalculable ET dans la fenêtre 30j sur computed_at) ;
//  (3) le résumé marchand qui compare deux états produit (basculements + troncature).
//  Rien n'appelle encore ces fonctions — c'est voulu. engine.js intouché.
//  node tests/lot19_recalc_margins.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  isRecalcableCostSource,
  selectDeletableLines,
  formatProductNames,
  buildRecalcSummary,
} from "../app/lib/recalcMargins.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// ── isRecalcableCostSource : les 4 valeurs connues + inconnue ──
console.log("\n── isRecalcableCostSource : recalculable ⇔ estimated|missing ──");
{
  ok(isRecalcableCostSource("estimated") === true,  "estimated → recalculable");
  ok(isRecalcableCostSource("missing")   === true,  "missing → recalculable");
  ok(isRecalcableCostSource("confirmed") === false, "confirmed → IMMUABLE (autorité marchand)");
  ok(isRecalcableCostSource("imported")  === false, "imported → IMMUABLE (CSV marchand)");
  ok(isRecalcableCostSource("bizarre")   === false, "valeur inconnue → IMMUABLE (défaut sûr)");
  ok(isRecalcableCostSource(null)        === false, "null → IMMUABLE");
  ok(isRecalcableCostSource(undefined)   === false, "undefined → IMMUABLE");
}

// ── selectDeletableLines : recalculable ET dans la fenêtre 30j (computed_at) ──
console.log("\n── selectDeletableLines : recalculable ∧ fenêtre 30j ──");
{
  const now = new Date("2026-07-22T00:00:00Z");
  const iso = (daysAgo) => new Date(Date.UTC(2026, 6, 22) - daysAgo * 86_400_000).toISOString();
  const rows = [
    { order_id: "o1", line_item_id: "l1", cost_source: "estimated", computed_at: iso(5) },   // ✓ recalc, dans fenêtre
    { order_id: "o2", line_item_id: "l2", cost_source: "missing",   computed_at: iso(29) },  // ✓ recalc, limite fenêtre
    { order_id: "o3", line_item_id: "l3", cost_source: "estimated", computed_at: iso(31) },  // ✗ hors fenêtre → garde
    { order_id: "o4", line_item_id: "l4", cost_source: "confirmed", computed_at: iso(2) },   // ✗ immuable
    { order_id: "o5", line_item_id: "l5", cost_source: "imported",  computed_at: iso(1) },   // ✗ immuable
    { order_id: "o6", line_item_id: "l6", cost_source: "missing",   computed_at: null },     // ✗ sans computed_at → garde
  ];
  const del = selectDeletableLines(rows, now);
  const ids = del.map((d) => d.order_id);
  ok(ids.join(",") === "o1,o2", "ne supprime QUE o1,o2 (recalculables ET dans la fenêtre)");
  ok(del.every((d) => "order_id" in d && "line_item_id" in d), "retourne {order_id, line_item_id} minimal");
  ok(del.length === 2, "confirmed/imported/hors-fenêtre/sans-computed_at : tous préservés");

  ok(selectDeletableLines(rows, "pas une date").length === 0, "horloge invalide ⇒ ne rien supprimer");
  ok(selectDeletableLines(null, now).length === 0, "rows null ⇒ [] (null-safe)");
  ok(selectDeletableLines(rows, now, { windowDays: 0 }).length === 0, "fenêtre 0j ⇒ rien de re-synchronisable");
  const large = selectDeletableLines(rows, now, { windowDays: 60 });
  ok(large.map((d) => d.order_id).join(",") === "o1,o2,o3", "fenêtre 60j ⇒ o3 rentre aussi");
}

// ── formatProductNames : troncature « max 5 + et N autres » ──
console.log("\n── formatProductNames : troncature 5 ──");
{
  ok(formatProductNames([]) === "", "aucun nom → chaîne vide (l'UI masque la ligne)");
  ok(formatProductNames(["A", "B", "C"]) === "A, B, C", "≤ 5 → liste simple");
  ok(formatProductNames(["A", "B", "C", "D", "E"]) === "A, B, C, D, E", "pile 5 → pas de troncature");
  ok(formatProductNames(["A", "B", "C", "D", "E", "F"]) === "A, B, C, D, E et 1 autre",
     "6 → 5 + « et 1 autre » (singulier)");
  ok(formatProductNames(["A", "B", "C", "D", "E", "F", "G", "H"]) === "A, B, C, D, E et 3 autres",
     "8 → 5 + « et 3 autres » (pluriel)");
  ok(formatProductNames(["A", "", null, "B"]) === "A, B", "vides / non-string ignorés");
}

// ── buildRecalcSummary : aucun changement ──
console.log("\n── buildRecalcSummary : aucun changement ──");
{
  const etat = { lignes: 3, produits: [
    { product_id: "p1", name: "Tapis", net_margin: 10 },
    { product_id: "p2", name: "Lampe", net_margin: -2 },
  ] };
  const s = buildRecalcSummary(etat, etat);
  ok(s.produitsPassesAPerte.length === 0, "états identiques → aucun passé à perte");
  ok(s.produitsRedevenusRentables.length === 0, "états identiques → aucun redevenu rentable");
  ok(s.lignesRecalculees === 3, "lignesRecalculees = lignes de l'état après");
}

// ── buildRecalcSummary : N produits passés à perte ──
console.log("\n── buildRecalcSummary : produits passés à perte ──");
{
  const avant = { lignes: 4, produits: [
    { product_id: "p1", name: "Tapis", net_margin: 8 },
    { product_id: "p2", name: "Lampe", net_margin: 3 },
    { product_id: "p3", name: "Chaise", net_margin: -5 }, // déjà en perte avant → pas un basculement
  ] };
  const apres = { lignes: 4, produits: [
    { product_id: "p1", name: "Tapis", net_margin: -4 },  // rentable → perte
    { product_id: "p2", name: "Lampe", net_margin: -1 },  // rentable → perte
    { product_id: "p3", name: "Chaise", net_margin: -6 }, // perte → perte : ignoré
  ] };
  const s = buildRecalcSummary(avant, apres);
  ok(s.produitsPassesAPerte.join(",") === "Tapis,Lampe", "Tapis + Lampe passés à perte (ordre = apres)");
  ok(!s.produitsPassesAPerte.includes("Chaise"), "Chaise déjà en perte → PAS un basculement");
  ok(s.resume.passesAPerte === "Tapis, Lampe", "resume texte des passés à perte");
}

// ── buildRecalcSummary : > 5 produits à perte (troncature dans le resume) ──
console.log("\n── buildRecalcSummary : > 5 produits à perte ──");
{
  const noms = ["A", "B", "C", "D", "E", "F", "G"];
  const avant = { lignes: 7, produits: noms.map((n, i) => ({ product_id: `p${i}`, name: n, net_margin: 5 })) };
  const apres = { lignes: 7, produits: noms.map((n, i) => ({ product_id: `p${i}`, name: n, net_margin: -1 })) };
  const s = buildRecalcSummary(avant, apres);
  ok(s.produitsPassesAPerte.length === 7, "les 7 basculements sont bien tous listés (tableau complet)");
  ok(s.resume.passesAPerte === "A, B, C, D, E et 2 autres", "resume tronqué à 5 + « et 2 autres »");
}

// ── buildRecalcSummary : produits redevenus rentables ──
console.log("\n── buildRecalcSummary : redevenus rentables ──");
{
  const avant = { lignes: 2, produits: [
    { product_id: "p1", name: "Tapis", net_margin: -3 },
    { product_id: "p2", name: "Lampe", net_margin: 0 }, // 0 = rentable (perte STRICTE < 0)
  ] };
  const apres = { lignes: 2, produits: [
    { product_id: "p1", name: "Tapis", net_margin: 2 },  // perte → rentable
    { product_id: "p2", name: "Lampe", net_margin: 4 },  // rentable → rentable : ignoré
  ] };
  const s = buildRecalcSummary(avant, apres);
  ok(s.produitsRedevenusRentables.join(",") === "Tapis", "Tapis redevenu rentable (perte → ≥ 0)");
  ok(s.produitsPassesAPerte.length === 0, "aucun passé à perte");
}

// ── buildRecalcSummary : mix + états inconnus (marge non finie, produit absent) ──
console.log("\n── buildRecalcSummary : mix + états inconnus ──");
{
  const avant = { lignes: 5, produits: [
    { product_id: "p1", name: "Tapis", net_margin: 5 },     // → perte
    { product_id: "p2", name: "Lampe", net_margin: -2 },    // → rentable
    { product_id: "p3", name: "Chaise", net_margin: null }, // avant inconnu → jamais un basculement
    { product_id: "p4", name: "Vase", net_margin: 3 },      // absent d'apres → ignoré
  ] };
  const apres = { lignes: 5, produits: [
    { product_id: "p1", name: "Tapis", net_margin: -1 },
    { product_id: "p2", name: "Lampe", net_margin: 6 },
    { product_id: "p3", name: "Chaise", net_margin: -4 },   // apres connu mais avant inconnu → ignoré
    { product_id: "p5", name: "Cadre", net_margin: -9 },    // nouveau produit → pas de « avant » → ignoré
  ] };
  const s = buildRecalcSummary(avant, apres);
  ok(s.produitsPassesAPerte.join(",") === "Tapis", "seul Tapis bascule en perte (basculement connu-connu)");
  ok(s.produitsRedevenusRentables.join(",") === "Lampe", "seul Lampe redevient rentable");
  ok(!s.produitsPassesAPerte.includes("Chaise") && !s.produitsPassesAPerte.includes("Cadre"),
     "états inconnus (avant absent/non fini) exclus de tout basculement");
}

// ── buildRecalcSummary : repli de nom + null-safe ──
console.log("\n── buildRecalcSummary : repli de nom + entrées vides ──");
{
  const avant = { lignes: 1, produits: [{ product_id: "gid://shopify/Product/999", net_margin: 4 }] };
  const apres = { lignes: 1, produits: [{ product_id: "gid://shopify/Product/999", net_margin: -1 }] };
  const s = buildRecalcSummary(avant, apres);
  ok(s.produitsPassesAPerte[0] === "Produit 999", "nom absent → repli « Produit <id> »");

  const empty = buildRecalcSummary({}, {});
  ok(empty.produitsPassesAPerte.length === 0 && empty.lignesRecalculees === 0, "états vides ⇒ résumé neutre (null-safe)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 19 (recalcul marges — décisions pures) : ✓ Tous les tests passent"
  : ` BILAN LOT 19 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
