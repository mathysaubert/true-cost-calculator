// ── Simulateur boutique (S1) — point d'entrée PUR ─────────────────────────────────────────────
export { LEVERS, LEVER_IDS, RESULT_NODES, RANGE_VOLUME, leverById, leverAvailable, econLevers, econOverrides, valuesFromEconLevers, clamp, deltaTone } from "./levers.js";
export { HORIZONS, parseScenario, scenarioSearch, runScenario, scenarioRecord } from "./scenario.js";
import { valuesFromEconLevers } from "./levers.js";
import { scenarioSearch } from "./scenario.js";

// Lien de pré-chargement depuis un insight (règle avec simulation) ou une opportunité (leviers).
export function simulatorHref(insight, { days = null } = {}) {
  const levers = insight?.levers ?? insight?.simulation?.levers ?? {};
  return `/app/simulator${scenarioSearch({ values: valuesFromEconLevers(levers), rule: insight?.id ?? null, days })}`;
}
