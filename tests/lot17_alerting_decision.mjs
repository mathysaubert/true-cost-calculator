// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Alerting au volume — décision PURE (app/lib/profitabilityAlert.js).
//  decideAlertAction (envoyer / avancer / suppress / rien) + shouldAdvanceState (invariant G2 :
//  avancer SSI envoi réussi, JAMAIS pendant OFF). Aucun I/O : le cron (C4b-2) ne fait qu'appliquer.
//  Pour lancer : node tests/lot17_alerting_decision.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { decideAlertAction, shouldAdvanceState } from "../app/lib/profitabilityAlert.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// ── decideAlertAction : table de vérité complète (les 4 actions) ──
console.log("\n── decideAlertAction ──");
{
  // hasBasculements=false COURT-CIRCUITE tout, quel que soit alerting/email.
  ok(decideAlertAction({ hasBasculements: false, alertingEnabled: true,  hasEmail: true  }) === "nothing", "pas de basculement → 'nothing' (même ON + email)");
  ok(decideAlertAction({ hasBasculements: false, alertingEnabled: false, hasEmail: false }) === "nothing", "pas de basculement → 'nothing' (même OFF, sans email)");

  // basculement + OFF → 'suppress' (peu importe l'email).
  ok(decideAlertAction({ hasBasculements: true, alertingEnabled: false, hasEmail: true  }) === "suppress", "basculement + OFF (+ email) → 'suppress'");
  ok(decideAlertAction({ hasBasculements: true, alertingEnabled: false, hasEmail: false }) === "suppress", "basculement + OFF (sans email) → 'suppress'");

  // basculement + ON + pas d'email → 'advance_only' (G3).
  ok(decideAlertAction({ hasBasculements: true, alertingEnabled: true, hasEmail: false }) === "advance_only", "basculement + ON + pas d'email → 'advance_only' (G3)");

  // basculement + ON + email → 'send'.
  ok(decideAlertAction({ hasBasculements: true, alertingEnabled: true, hasEmail: true }) === "send", "basculement + ON + email → 'send'");

  // robustesse : appel sans argument → 'nothing' (pas de crash).
  ok(decideAlertAction() === "nothing", "aucun argument (défaut) → 'nothing'");
}

// ── shouldAdvanceState : les 5 lignes de la table (dont les 2 garde-fous critiques) ──
console.log("\n── shouldAdvanceState (invariant G2) ──");
{
  ok(shouldAdvanceState("nothing") === false, "'nothing' → pas d'avance");
  ok(shouldAdvanceState("suppress") === false, "'suppress' → JAMAIS avancer pendant OFF (zéro alerte perdue, rafale à la reprise)");
  ok(shouldAdvanceState("advance_only") === true, "'advance_only' → avance (G3 : pas d'email mais on avance)");
  ok(shouldAdvanceState("send", true) === true, "'send' + envoi réussi → avance");
  ok(shouldAdvanceState("send", false) === false, "'send' + échec envoi → PAS d'avance (réessai demain, invariant G2)");

  // robustesse : sendOk n'a de sens que pour 'send'.
  ok(shouldAdvanceState("send") === false, "'send' sans sendOk (défaut false) → pas d'avance");
  ok(shouldAdvanceState("suppress", true) === false, "'suppress' même avec sendOk=true → pas d'avance (OFF prime)");
  ok(shouldAdvanceState("advance_only", false) === true, "'advance_only' ignore sendOk → avance quand même");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 17 (décision alerting) : ✓ Tous les tests passent"
  : ` BILAN LOT 17 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
