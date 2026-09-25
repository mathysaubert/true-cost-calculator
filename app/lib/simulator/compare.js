// ── S2b — Comparaison de scénarios (W3) — PUR ─────────────────────────────────────────────────
// scenarios : [{ id, label, values }] (2 à 3, le courant en premier) ; tous rejoués sur les MÊMES
// feuilles du jour (jamais les montants enregistrés) : « recalculé sur la période courante ».
import { RESULT_NODES } from "./levers.js";
import { runScenario } from "./scenario.js";

export const COMPARE_MAX = 3;

// "id1,id2" → ids nettoyés, dédoublonnés, au plus COMPARE_MAX − 1 (le courant occupe une place).
export function parseCompareIds(raw) {
  return [...new Set(String(raw ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{8,64}$/i.test(s)))].slice(0, COMPARE_MAX - 1);
}

export function compareScenarios({ leaves = {}, periodDays = 30, horizon = "period", scenarios = [] } = {}) {
  const list = scenarios.slice(0, COMPARE_MAX);
  const runs = list.map((s) => ({ ...s, run: runScenario({ leaves, values: s.values ?? {}, periodDays, horizon }) }));
  const nodes = RESULT_NODES.map((n) => ({
    id: n.id, unit: n.unit, good: n.good,
    cells: runs.map((r) => { const x = r.run.nodes.find((m) => m.id === n.id) ?? {}; return { id: r.id, before: x.before ?? null, after: x.after ?? null, delta: x.delta ?? null, low: x.low ?? null, high: x.high ?? null }; }),
  }));
  return { scenarios: runs.map((r) => ({ id: r.id, label: r.label ?? null, rule_id: r.rule_id ?? null, values: r.run.values, empty: r.run.empty })), nodes };
}
