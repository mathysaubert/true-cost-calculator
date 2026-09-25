// ── S2a — Mode objectif (W1, W2) : « quel prix pour 55 % de CM2 ? » — PUR ──────────────────────
// Bissection MAISON sur runScenario (un levier à la fois, dans ses bornes d'écran) : fonctionne pour
// les 8 leviers, y compris fulfilment et budget pub qui sont des surcharges, sans toucher à
// econ/simulate.js (findThreshold reste intouché). Monotonie supposée sur l'intervalle.
import { LEVERS, RESULT_NODES, leverAvailable } from "./levers.js";
import { runScenario } from "./scenario.js";

export const OBJECTIVE_NODES = RESULT_NODES.map((n) => n.id).concat(["cm2_pct"]);
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

function nodeAfter(run, node) {
  if (node === "cm2_pct") {
    const cm2 = run.nodes.find((n) => n.id === "cm2")?.after, ca = run.nodes.find((n) => n.id === "ca_ht")?.after;
    return cm2 == null || !(ca > 0) ? null : (cm2 / ca) * 100;
  }
  return run.nodes.find((n) => n.id === node)?.after ?? null;
}

// { leaves, periodDays, horizon, node, target, lever, base } → { reached, value, after, reason, best }
export function solveObjective({ leaves = {}, periodDays = 30, horizon = "period", node, target, lever, base = {}, iterations = 40 } = {}) {
  const l = LEVERS.find((x) => x.id === lever);
  const t = num(target);
  if (!l || !OBJECTIVE_NODES.includes(node) || t == null) return { reached: false, reason: "invalid" };
  if (!leverAvailable(l, leaves)) return { reached: false, reason: "unavailable" };
  const f = (v) => nodeAfter(runScenario({ leaves, values: { ...base, [lever]: v }, periodDays, horizon }), node);
  let lo = l.min, hi = l.max, fLo = f(lo), fHi = f(hi);
  if (fLo == null || fHi == null) return { reached: false, reason: "unavailable" };
  if ((fLo - t) * (fHi - t) > 0) {
    // Cible hors de portée : le meilleur des deux bords (le plus proche de la cible).
    const bestLo = Math.abs(fLo - t) <= Math.abs(fHi - t);
    return { reached: false, reason: "out_of_range", best: { value: bestLo ? lo : hi, after: bestLo ? fLo : fHi }, min: l.min, max: l.max };
  }
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2, fm = f(mid);
    if (fm == null) return { reached: false, reason: "unavailable" };
    if ((fm - t) * (fLo - t) <= 0) { hi = mid; fHi = fm; } else { lo = mid; fLo = fm; }
  }
  const value = l.kind === "money" ? Math.round((lo + hi) / 2) : Math.round(((lo + hi) / 2) * 10) / 10;
  return { reached: true, value, after: f(value), node, lever, target: t };
}
