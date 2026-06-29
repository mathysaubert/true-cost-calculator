// ── Dunning — décision PURE de relance (aucun I/O, aucun React, aucun réseau) ─
// Cœur du dunning, pendant de computeProfitabilityChanges : à partir du STATUT
// d'abonnement COURANT (lu à l'instant T par le cron via allSubscriptions) et de l'état
// de dunning STOCKÉ (subscription_dunning_state), décide UNE action. Le cron exécute,
// puis n'avance le compteur/la date qu'APRÈS un envoi réussi (garde-fou G2).
//
// Les 3 pièges sont verrouillés ICI, par construction :
//   1. Jamais relancer un 'active'/'cancelled' → seul 'frozen' peut produire 'send_dunning'.
//   2. Jamais dépasser le plafond → 'frozen' avec count ≥ max ⇒ 'nothing'.
//   3. Jamais relancer après 'cancelled' → 'cancelled' ⇒ 'stop_cancelled' (aucun mail de relance).
//
// Cadence : ~2 relances/semaine = espacement minimal de 3 jours (la cadence vit dans la
// DONNÉE — last_dunning_at —, pas dans le schedule du cron, qui tourne quotidiennement).

export const DUNNING_MAX = 5;            // plafond de relances par épisode frozen
export const DUNNING_INTERVAL_DAYS = 3;  // espacement minimal entre deux relances
const DAY_MS = 86_400_000;

// Actions possibles (le cron mappe chacune sur un effet) :
//   'send_dunning'   → recréer une charge + mail de relance, puis count++ / last_dunning_at=now
//   'send_resolved'  → mail "c'est réglé" (une fois), puis reset count=0
//   'stop_cancelled' → marquer cancelled, plus jamais de mail
//   'nothing'        → ne rien faire (cadence non écoulée, plafond atteint, statut neutre…)
export function decideDunningAction({
  status,
  state = {},
  now = Date.now(),
  maxDunning = DUNNING_MAX,
  intervalDays = DUNNING_INTERVAL_DAYS,
} = {}) {
  const count = Number.isFinite(+state.dunning_count) ? +state.dunning_count : 0;
  const lastAt = state.last_dunning_at ? Date.parse(state.last_dunning_at) : NaN;
  // Première relance (jamais relancé) OU délai écoulé → cadence OK.
  const intervalElapsed = !Number.isFinite(lastAt) || (now - lastAt) >= intervalDays * DAY_MS;

  switch (status) {
    case "frozen":
      if (count >= maxDunning) return "nothing";   // plafond atteint → ne JAMAIS spammer
      if (!intervalElapsed)    return "nothing";    // cadence pas encore écoulée
      return "send_dunning";
    case "active":
      return count > 0 ? "send_resolved" : "nothing"; // "réglé" seulement si on relançait
    case "cancelled":
      return "stop_cancelled";                        // Shopify a tranché → stop définitif
    default:
      return "nothing";                               // pending, expired, inconnu → rien
  }
}
