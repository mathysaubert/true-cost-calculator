// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Reaper — décisions PURES (app/lib/sessionReaper.js). nextSessionHealth
//  (incrément/reset) + shouldReapSession (les DEUX seuils requis). Verrouille le risque
//  central : ne JAMAIS supprimer une session récupérable (seuils échecs ET ancienneté).
//  Pour lancer : node tests/lot14_session_reaper.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { nextSessionHealth, shouldReapSession, REAP_MIN_FAILURES, REAP_MIN_AGE_DAYS } from "../app/lib/sessionReaper.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const NOW = Date.parse("2026-07-02T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

// ── nextSessionHealth : succès → reset ──
console.log("\n── nextSessionHealth : succès remet à zéro ──");
{
  const h = nextSessionHealth({ consecutive_failures: 8, first_failure_at: daysAgo(30), last_failure_at: daysAgo(1) }, "success", NOW);
  ok(h.consecutive_failures === 0, "compteur remis à 0");
  ok(h.first_failure_at === null, "first_failure_at effacé (série close)");
  ok(h.last_success_at === new Date(NOW).toISOString(), "last_success_at = now");
}

// ── nextSessionHealth : 1er échec → compteur 1 + first_failure_at fixé ──
console.log("\n── nextSessionHealth : premier échec ──");
{
  const h = nextSessionHealth({}, "failure", NOW);
  ok(h.consecutive_failures === 1, "compteur = 1");
  ok(h.first_failure_at === new Date(NOW).toISOString(), "first_failure_at fixé à now");
  ok(h.last_failure_at === new Date(NOW).toISOString(), "last_failure_at = now");
}

// ── nextSessionHealth : échec suivant → incrément, first_failure_at PRÉSERVÉ ──
console.log("\n── nextSessionHealth : échec suivant ──");
{
  const first = daysAgo(5);
  const h = nextSessionHealth({ consecutive_failures: 3, first_failure_at: first }, "failure", NOW);
  ok(h.consecutive_failures === 4, "compteur incrémenté (3 → 4)");
  ok(h.first_failure_at === first, "first_failure_at préservé (pas réécrit)");
}

// ── shouldReapSession : sous le seuil d'ÉCHECS → false ──
console.log("\n── shouldReap : pas assez d'échecs ──");
{
  ok(shouldReapSession({ health: { consecutive_failures: 9, first_failure_at: daysAgo(90) }, now: NOW }) === false, "9 échecs (< 10) même très ancien → pas de suppression");
}

// ── shouldReapSession : sous le seuil d'ANCIENNETÉ → false ──
console.log("\n── shouldReap : trop récent ──");
{
  ok(shouldReapSession({ health: { consecutive_failures: 50, first_failure_at: daysAgo(20) }, now: NOW }) === false, "50 échecs mais série vieille de 20 j (< 21) → pas de suppression");
}

// ── shouldReapSession : les DEUX seuils atteints → true ──
console.log("\n── shouldReap : les deux seuils atteints ──");
{
  ok(shouldReapSession({ health: { consecutive_failures: 10, first_failure_at: daysAgo(21) }, now: NOW }) === true, "10 échecs ET 21 j → suppression");
  ok(shouldReapSession({ health: { consecutive_failures: 40, first_failure_at: daysAgo(60) }, now: NOW }) === true, "largement au-delà → suppression");
}

// ── frontières STRICTES : pile 10 échecs / pile 21 j → true (≥) ──
console.log("\n── frontières (≥) ──");
{
  ok(shouldReapSession({ health: { consecutive_failures: REAP_MIN_FAILURES, first_failure_at: daysAgo(REAP_MIN_AGE_DAYS) }, now: NOW }) === true, "pile 10 / pile 21 j → true");
  const justUnderAge = new Date(NOW - (REAP_MIN_AGE_DAYS * 86_400_000) + 1000).toISOString();
  ok(shouldReapSession({ health: { consecutive_failures: 10, first_failure_at: justUnderAge }, now: NOW }) === false, "21 j moins 1 s → false");
}

// ── robustesse : first_failure_at absent / health vide → false (jamais supprimer à l'aveugle) ──
console.log("\n── robustesse ──");
{
  ok(shouldReapSession({ health: { consecutive_failures: 99 }, now: NOW }) === false, "99 échecs mais first_failure_at absent → false (ancienneté inconnue)");
  ok(shouldReapSession({ health: {}, now: NOW }) === false, "health vide → false");
  ok(shouldReapSession({}) === false, "aucun argument → false");
  ok(REAP_MIN_FAILURES === 10 && REAP_MIN_AGE_DAYS === 21, "constantes : 10 échecs / 21 j");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 14 (reaper sessions) : ✓ Tous les tests passent"
  : ` BILAN LOT 14 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
