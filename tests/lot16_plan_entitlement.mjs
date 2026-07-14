// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Plan — droit au plan payant (app/lib/plan.js, PUR). Le cœur : un abonnement
//  FROZEN (paiement échoué, fenêtre de grâce Shopify) donne TOUJOURS droit au plan payant —
//  c'est le bug que le loader/l'action masquaient en filtrant sur status === "ACTIVE".
//  Pour lancer : node tests/lot16_plan_entitlement.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { planEntitlement } from "../app/lib/plan.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const PRO = "True Cost Calculator Pro", EXPERT = "True Cost Calculator Expert";
const node = (name, status) => ({ id: `gid://x/${Math.random()}`, name, status });
const ent = (nodes) => planEntitlement(nodes, PRO, EXPERT);

// ── ACTIVE : droit au plan (référence) ──
console.log("\n── ACTIVE ──");
{
  const p = ent([node(PRO, "ACTIVE")]);
  ok(p.isPro && !p.isExpert, "Pro ACTIVE → isPro, pas Expert");
  const e = ent([node(EXPERT, "ACTIVE")]);
  ok(e.isPro && e.isExpert, "Expert ACTIVE → isPro ET isExpert");
}

// ── FROZEN : LE FIX — droit MAINTENU pendant la fenêtre de grâce ──
console.log("\n── FROZEN : accès maintenu (fenêtre de grâce) ──");
{
  const p = ent([node(PRO, "FROZEN")]);
  ok(p.isPro === true, "Pro FROZEN → isPro = true (plus de rétrogradation au 1er échec)");
  ok(p.isExpert === false, "Pro FROZEN → pas Expert");
  const e = ent([node(EXPERT, "FROZEN")]);
  ok(e.isPro && e.isExpert, "Expert FROZEN → isPro ET isExpert");
}

// ── CANCELLED / EXPIRED / DECLINED / PENDING → pas d'abonnement → free ──
console.log("\n── statuts NON entitlants → free ──");
{
  for (const st of ["CANCELLED", "EXPIRED", "DECLINED", "PENDING"]) {
    const p = ent([node(PRO, st)]);
    ok(!p.isPro && !p.isExpert, `Pro ${st} → free (ni isPro ni isExpert)`);
  }
  ok(!ent([]).isPro, "aucun abonnement → free");
}

// ── allSubscriptions bruité : un FROZEN Pro parmi des CANCELLED/EXPIRED → isPro ──
console.log("\n── FROZEN noyé dans le bruit d'historique ──");
{
  const p = ent([node(EXPERT, "CANCELLED"), node(PRO, "EXPIRED"), node(PRO, "FROZEN"), node(PRO, "DECLINED")]);
  ok(p.isPro === true && p.isExpert === false, "FROZEN Pro compté malgré CANCELLED/EXPIRED/DECLINED autour");
  // Expert ACTIVE présent → isExpert même si un vieux Pro traîne.
  const e = ent([node(PRO, "CANCELLED"), node(EXPERT, "ACTIVE")]);
  ok(e.isPro && e.isExpert, "Expert ACTIVE + vieux Pro CANCELLED → isExpert");
}

// ── robustesse : entrées absentes / malformées ──
console.log("\n── robustesse ──");
{
  ok(!planEntitlement(undefined, PRO, EXPERT).isPro, "nodes undefined → free (pas de crash)");
  ok(!ent([null, { name: PRO }, { status: "FROZEN" }]).isPro, "nœuds partiels (name/status manquants) → free");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 16 (droit au plan) : ✓ Tous les tests passent"
  : ` BILAN LOT 16 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
