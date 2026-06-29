// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Dunning — décision PURE (app/lib/dunning.js). Asserts sur l'action
//  retournée selon statut d'abonnement courant + état de dunning stocké. Aucun I/O.
//  Verrouille les 3 pièges : jamais relancer active/cancelled, jamais dépasser le plafond.
//  Pour lancer : node tests/lot11_dunning_decision.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { decideDunningAction, DUNNING_MAX, DUNNING_INTERVAL_DAYS } from "../app/lib/dunning.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const NOW = Date.parse("2026-06-29T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const decide = (status, state) => decideDunningAction({ status, state, now: NOW });

// ── frozen + count<5 + ≥3j → send_dunning ──
console.log("\n── frozen, sous plafond, cadence écoulée ──");
{
  ok(decide("frozen", { dunning_count: 0, last_dunning_at: null }) === "send_dunning", "1re relance (jamais relancé) → send_dunning");
  ok(decide("frozen", { dunning_count: 2, last_dunning_at: daysAgo(3) }) === "send_dunning", "count 2, dernier envoi il y a 3 j → send_dunning");
  ok(decide("frozen", { dunning_count: 4, last_dunning_at: daysAgo(10) }) === "send_dunning", "count 4 (< plafond) → send_dunning");
}

// ── frozen + count<5 + <3j → nothing (cadence pas écoulée) ──
console.log("\n── frozen, cadence pas écoulée ──");
{
  ok(decide("frozen", { dunning_count: 1, last_dunning_at: daysAgo(2) }) === "nothing", "dernier envoi il y a 2 j (<3) → nothing");
  ok(decide("frozen", { dunning_count: 1, last_dunning_at: daysAgo(0) }) === "nothing", "envoyé aujourd'hui → nothing");
}

// ── PIÈGE 2 : frozen + count>=5 → nothing (plafond) ──
console.log("\n── PIÈGE plafond : frozen, count >= 5 ──");
{
  ok(decide("frozen", { dunning_count: 5, last_dunning_at: daysAgo(30) }) === "nothing", "count 5 = plafond → nothing (même très espacé)");
  ok(decide("frozen", { dunning_count: 9, last_dunning_at: daysAgo(30) }) === "nothing", "count 9 > plafond → nothing");
  ok(DUNNING_MAX === 5 && DUNNING_INTERVAL_DAYS === 3, "constantes : plafond 5 / espacement 3 j");
}

// ── active + count>0 → send_resolved ──
console.log("\n── active après relances → resolved ──");
{
  ok(decide("active", { dunning_count: 1, last_dunning_at: daysAgo(1) }) === "send_resolved", "paiement régularisé pendant le dunning → send_resolved");
  ok(decide("active", { dunning_count: 5, last_dunning_at: daysAgo(1) }) === "send_resolved", "résolu même au plafond → send_resolved");
}

// ── PIÈGE 1 : active + count=0 → nothing (jamais été en dunning) ──
console.log("\n── PIÈGE : active jamais relancé → silence ──");
{
  ok(decide("active", { dunning_count: 0, last_dunning_at: null }) === "nothing", "active sain (count 0) → nothing, jamais de mail intempestif");
}

// ── PIÈGE 3 : cancelled → stop_cancelled (plus jamais de relance) ──
console.log("\n── PIÈGE : cancelled → stop définitif ──");
{
  ok(decide("cancelled", { dunning_count: 3, last_dunning_at: daysAgo(3) }) === "stop_cancelled", "cancelled pendant dunning → stop_cancelled (pas send_dunning)");
  ok(decide("cancelled", { dunning_count: 0 }) === "stop_cancelled", "cancelled → stop_cancelled");
}

// ── pending / inconnu → nothing ──
console.log("\n── statuts neutres (pending, expired, inconnu) ──");
{
  ok(decide("pending", { dunning_count: 2, last_dunning_at: daysAgo(5) }) === "nothing", "pending (charge en attente d'approbation) → nothing");
  ok(decide("expired", { dunning_count: 1 }) === "nothing", "expired → nothing");
  ok(decide("whatever", {}) === "nothing", "statut inconnu → nothing");
}

// ── frontière cadence STRICTE : exactement 3 j → send_dunning (≥) ──
console.log("\n── frontière cadence : exactement 3 jours ──");
{
  const exactly3 = new Date(NOW - DUNNING_INTERVAL_DAYS * 86_400_000).toISOString();
  ok(decide("frozen", { dunning_count: 1, last_dunning_at: exactly3 }) === "send_dunning", "pile 3 j → send_dunning (comparaison ≥)");
  const justUnder = new Date(NOW - (DUNNING_INTERVAL_DAYS * 86_400_000) + 1000).toISOString();
  ok(decide("frozen", { dunning_count: 1, last_dunning_at: justUnder }) === "nothing", "3 j moins 1 s → nothing");
}

// ── robustesse : état absent / champs manquants ──
console.log("\n── robustesse entrées ──");
{
  ok(decideDunningAction({ status: "frozen", now: NOW }) === "send_dunning", "state absent → traité comme count 0, jamais relancé → send_dunning");
  ok(decideDunningAction({ status: "frozen", state: {}, now: NOW }) === "send_dunning", "state vide → send_dunning");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 11 (décision dunning) : ✓ Tous les tests passent"
  : ` BILAN LOT 11 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
