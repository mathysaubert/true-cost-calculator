// ── Reaper de sessions mortes — décisions PURES (aucun I/O, aucun réseau) ────
// Deux fonctions pures, pendant de dunning.js :
//   • nextSessionHealth : applique l'issue d'un probe admin à l'état de santé stocké.
//       succès             → compteur remis à 0 (série d'échecs terminée).
//       admin_unauthorized → compteur++ (first_failure_at fixé au 1er échec de la série).
//   • shouldReapSession : décide la suppression de la ligne Session à partir des FAITS.
// On ne décide JAMAIS sur un seul run (un 401 transitoire rafraîchissable et un 401 désinstallé
// sont indistinguables) : seule la répétition dans le temps déclenche la suppression.
// N.B. le cron n'appelle ces fonctions que sur un ÉCHEC D'ACQUISITION ADMIN (throw de
// unauthenticated.admin), jamais sur une erreur d'opération (ex. bulk ACCESS_DENIED = session vivante).

export const REAP_MIN_FAILURES = 10;  // échecs consécutifs mini avant suppression
export const REAP_MIN_AGE_DAYS = 21;  // ancienneté mini de la série d'échecs (jours)
const DAY_MS = 86_400_000;

// Applique une issue de probe ('success' | 'failure') à l'état de santé → nouvel état (pur).
export function nextSessionHealth(prev = {}, outcome, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  if (outcome === "success") {
    return {
      consecutive_failures: 0,
      first_failure_at: null,                         // série close
      last_failure_at: prev?.last_failure_at ?? null, // conservé (audit)
      last_success_at: nowIso,
    };
  }
  // 'failure' = admin_unauthorized (throw unauthenticated.admin), déjà après tentative de refresh.
  return {
    consecutive_failures: (Number(prev?.consecutive_failures) || 0) + 1,
    first_failure_at: prev?.first_failure_at ?? nowIso, // fixé au 1er échec de la série
    last_failure_at: nowIso,
    last_success_at: prev?.last_success_at ?? null,
  };
}

// Décide si la ligne Session doit être supprimée. Conservateur : les DEUX seuils requis.
export function shouldReapSession({ health = {}, now = Date.now(), minFailures = REAP_MIN_FAILURES, minAgeDays = REAP_MIN_AGE_DAYS } = {}) {
  const failures = Number(health?.consecutive_failures) || 0;
  if (failures < minFailures) return false;                    // pas assez d'échecs

  const first = health?.first_failure_at ? Date.parse(health.first_failure_at) : NaN;
  if (!Number.isFinite(first)) return false;                   // ancienneté inconnue → on s'abstient

  return (now - first) >= minAgeDays * DAY_MS;                 // série assez ancienne (≥)
}
