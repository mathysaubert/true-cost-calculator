// ── Scénario (S1) — PUR : URL ↔ valeurs, exécution avec fourchette T5, horizon T4b ──────────────
import { applyLevers, simulate } from "../econ/simulate.js";
import { LEVERS, RESULT_NODES, RANGE_VOLUME, clamp, econLevers, econOverrides, leverAvailable } from "./levers.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const round1 = (v) => Math.round(v * 10) / 10;
export const HORIZONS = ["period", "month"];

// Paramètres d'URL (ou FormData) → { values, rule, horizon } ; inconnu ou hors bornes → borné / ignoré.
export function parseScenario(get) {
  const g = typeof get === "function" ? get : (k) => (get?.get ? get.get(k) : get?.[k]);
  const values = {};
  for (const l of LEVERS) {
    const raw = g(l.id);
    if (raw == null || raw === "") continue;
    const v = num(String(raw).replace(",", "."));
    if (v == null) continue;
    values[l.id] = clamp(l, round1(v));
  }
  const rule = String(g("rule") ?? "").trim().replace(/[^a-z0-9_]/g, "") || null;
  const h = String(g("h") ?? "");
  return { values, rule, horizon: HORIZONS.includes(h) ? h : "period" };
}

// Valeurs → chaîne de requête (sans les zéros), pour les liens de pré-chargement et de rejeu.
export function scenarioSearch({ values = {}, rule = null, days = null, horizon = null } = {}) {
  const p = new URLSearchParams();
  if (days) p.set("days", String(days));
  for (const l of LEVERS) { const v = num(values[l.id]); if (v != null && v !== 0) p.set(l.id, String(round1(v))); }
  if (rule) p.set("rule", rule);
  if (horizon && horizon !== "period") p.set("h", horizon);
  const s = p.toString();
  return s ? `?${s}` : "";
}

// Exécution : avant / après / écart par nœud, fourchette (volume −10 % / +10 %), hypothèses.
// horizon "month" : montants × 30 / jours de la période (T4b) ; les ratios ne bougent pas.
export function runScenario({ leaves = {}, values = {}, periodDays = 30, horizon = "period" } = {}) {
  const active = Object.fromEntries(Object.entries(values).filter(([id, v]) => { const l = LEVERS.find((x) => x.id === id); return l && num(v) != null && leverAvailable(l, leaves) && (l.kind !== "pct" || num(v) !== 0); }));
  const levers = econLevers(active);
  const { inputs: levered } = applyLevers(leaves, levers);
  const overrides = econOverrides(active, levered);
  const run = (extraVolume = 1) => {
    const lv = extraVolume === 1 ? levers : { ...levers, cvr_factor: (levers.cvr_factor ?? 1) * extraVolume };
    const lvd = applyLevers(leaves, lv).inputs;
    const ov = econOverrides(active, lvd);
    return simulate({ inputs: leaves, levers: lv, overrides: ov });
  };
  const base = run(1), low = run(RANGE_VOLUME.low), high = run(RANGE_VOLUME.high);
  const scale = horizon === "month" && periodDays > 0 ? 30 / periodDays : 1;
  const nodes = RESULT_NODES.map((n) => {
    const s = n.unit === "money" ? scale : 1;
    const v = (x) => (x == null ? null : x * s);
    const lo = v(low.after[n.id]), hi = v(high.after[n.id]);
    return { id: n.id, unit: n.unit, good: n.good, before: v(base.before[n.id]), after: v(base.after[n.id]), delta: v(base.delta[n.id]), low: lo == null || hi == null ? null : Math.min(lo, hi), high: lo == null || hi == null ? null : Math.max(lo, hi) };
  });
  return { values: active, levers, overrides, nodes, assumptions: base.assumptions, note: base.note, horizon, scale, periodDays, empty: Object.keys(active).length === 0 };
}

// Scénario rejouable pour decision_log (S1 ↔ I0-C).
export function scenarioRecord({ run, rule = null, days = null }) {
  const cm2 = run.nodes.find((n) => n.id === "cm2") ?? {};
  return {
    rule_id: rule, source: "simulator", days, horizon: run.horizon,
    values: run.values, levers: run.levers, overrides: run.overrides,
    assumptions: (run.assumptions ?? []).map((a) => a.key),
    node: "cm2", before: cm2.before ?? null, after: cm2.after ?? null,
    range: { low: cm2.low == null || cm2.before == null ? null : cm2.low - cm2.before, high: cm2.high == null || cm2.before == null ? null : cm2.high - cm2.before },
  };
}
