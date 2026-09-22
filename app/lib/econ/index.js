// ── Moteur économique — point d'entrée (PUR) ──────────────────────────────────────────────────
// Source unique de tous les KPI, seuils, simulations (brief §8). Aucun I/O : F2 fournit les lignes
// (ingestion) et les écrans consomment `aggregate` ; engine.js est enveloppé, jamais modifié.
export { MIN_DATA, BENCHMARKS, EU_VAT_STANDARD, FR_REDUCED_VAT_BY_CATEGORY, PLATFORM_UTM_SOURCES, DEFAULT_RETURN_WINDOW_DAYS } from "./config.js";
export { isEuCountry, vatRateFor } from "./vat.js";
export { unitPrices, countedUnits, landedCostUnit, computeLineEconomics } from "./line.js";
export { allocateOrderCosts } from "./allocate.js";
export { NODES, LEAF_INPUTS, nodeById, topologicalOrder, evaluate } from "./nodes.js";
export { minDataFor, gate } from "./minData.js";
export { thresholds } from "./thresholds.js";
export { simulate, applyLevers, findThreshold } from "./simulate.js";
export { aggregate, orderCosts, orderCommissions, fixedCostsForWindow, platformOfUtm, businessHoursBetween } from "./aggregate.js";
