// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Audit catalogue — classification alignée sur le SEUIL du marchand (PUR)
//  Régression corrigée : l'audit classait en dur (≥15 % winner, 0–15 % risky) alors que
//  le marchand configure profitability_threshold_pct (le MÊME seuil que l'alerting email B7).
//  Un produit à 20 % avec seuil 25 % était « Top Performer » ici mais « sous le seuil » dans
//  l'email — l'app se contredisait. Ce lot verrouille : audit ≡ seuil configuré ≡ B7.
//  engine.js intouché. node tests/lot18_audit_classify.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { auditCategory, classifyAudit, auditLabels } from "../app/lib/auditClassify.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// ── frontières au seuil configuré (t = 25) ──
console.log("\n── auditCategory : frontières au seuil 25 % ──");
{
  ok(auditCategory(25, 25) === "winner", "25 % pile au seuil → winner (borne inclusive, cohérente B7 ≥)");
  ok(auditCategory(24.99, 25) === "risky", "24,99 % → risky (rentable mais sous l'objectif)");
  ok(auditCategory(20, 25) === "risky", "LE BUG CORRIGÉ : 20 % avec seuil 25 → risky, PAS Top Performer");
  ok(auditCategory(0, 25) === "risky", "0 % → risky (rentable au sens strict, sous l'objectif)");
  ok(auditCategory(-0.01, 25) === "loser", "-0,01 % → loser (perte réelle)");
  ok(auditCategory(60, 25) === "winner", "60 % → winner");
}

// ── seuil 0 (défaut : n'alerter qu'en perte réelle) : bande « risky » VIDE ──
console.log("\n── seuil 0 : bande risky structurellement vide ──");
{
  ok(auditCategory(0, 0) === "winner", "0 % avec seuil 0 → winner (≥ 0, pas une perte)");
  ok(auditCategory(0.01, 0) === "winner", "0,01 % → winner");
  ok(auditCategory(-0.01, 0) === "loser", "-0,01 % → loser");
  const { losers, risky, winners } = classifyAudit(
    [{ netPct: 40 }, { netPct: 0 }, { netPct: -5 }, { netPct: 12 }], 0);
  ok(risky.length === 0, "seuil 0 → aucun produit « à risque » (0 ≤ x < 0 impossible)");
  ok(winners.length === 3 && losers.length === 1, "seuil 0 → tout rentable = winner, seule la perte réelle = loser");
}

// ── partition complète + ordre préservé ──
console.log("\n── classifyAudit : partition + ordre ──");
{
  const prods = [{ id: "a", netPct: 30 }, { id: "b", netPct: 10 }, { id: "c", netPct: -4 }, { id: "d", netPct: 25 }, { id: "e", netPct: 0 }];
  const { losers, risky, winners } = classifyAudit(prods, 25);
  ok(winners.map(p => p.id).join("") === "ad", "winners = a,d (≥25) dans l'ordre d'entrée");
  ok(risky.map(p => p.id).join("") === "be", "risky = b,e (0≤x<25)");
  ok(losers.map(p => p.id).join("") === "c", "losers = c (<0)");
  ok(winners.length + risky.length + losers.length === prods.length, "partition exhaustive (aucun produit perdu ni compté deux fois)");
}

// ── robustesse : netPct non fini → loser (jamais winner à tort) ──
console.log("\n── netPct manquant / non fini ──");
{
  ok(auditCategory(undefined, 25) === "loser", "undefined → loser (pas winner par défaut)");
  ok(auditCategory(NaN, 25) === "loser", "NaN → loser");
  ok(auditCategory(10, undefined) === "winner", "seuil absent (→0) : 10 % → winner");
  ok(auditCategory(10, -5) === "winner", "seuil négatif normalisé à 0 : 10 % → winner");
}

// ── libellés : décrivent les bornes RÉELLES (le bug d'origine était un libellé faux) ──
console.log("\n── auditLabels : cohérence libellé ≡ calcul ──");
{
  const L = auditLabels(25);
  ok(L.winners === "marge ≥ 25 %", `winners → « ${L.winners} » (pas « > 15 % »)`);
  ok(L.risky === "marge 0 à 25 %", `risky → « ${L.risky} »`);
  ok(L.losers === "marge < 0 %", "losers → « marge < 0 % »");

  const L0 = auditLabels(0);
  ok(L0.risky === "seuil à 0 %, bande inactive", `seuil 0 : libellé risky lisible, pas « marge 0 à 0 % » absurde (${L0.risky})`);
  ok(L0.winners === "marge ≥ 0 %", "seuil 0 : winners → « marge ≥ 0 % »");

  const Ld = auditLabels(25.5);
  ok(Ld.winners === "marge ≥ 25,5 %", `seuil décimal formaté FR : « ${Ld.winners} »`);
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 18 (classification audit) : ✓ Tous les tests passent"
  : ` BILAN LOT 18 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
