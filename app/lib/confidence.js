// ── Fiabilité des données (Phase 0 I0 §4, D8) — PUR ──────────────────────────────────────────
// Score 0-100 par règles documentées (CONFIDENCE_RULES) : mesure ∈ [0, 1] × poids ; un critère non
// applicable sort du dénominateur. Chaque règle dit ce qu'elle débloque et `points_if_fixed`.
// Entrées : aggregate courante, réglages, contexte (import UE pertinent ?).
import { CONFIDENCE_RULES, CONFIDENCE_LEVELS } from "./insights/config.js";
import { isEuCountry } from "./econ/vat.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Mesures par règle : { applicable, measure } — toutes lues dans les sorties du moteur.
export const MEASURES = {
  cost_coverage: ({ agg }) => {
    const l = agg?.shop?.leaves ?? {};
    const ca = num(l.known_ca_ht) + num(l.unknown_ca_ht);
    return { applicable: ca > 0, measure: ca > 0 ? clamp01(num(l.known_ca_ht) / ca) : 0 };
  },
  ads_connected: ({ agg, sources }) => {
    const attributed = num(agg?.shop?.leaves?.attributed_orders);
    return { applicable: sources?.ads === true || attributed > 0, measure: sources?.ads ? 1 : 0 };
  },
  shipping_costs: ({ agg, settings }) => {
    const orders = num(agg?.counts?.orders), g = agg?.dataGaps ?? {};
    const unconfirmed = orders > 0 ? clamp01(1 - num(g.unconfirmed_shipping) / orders) : 0;
    const packaging = settings?.packaging_cost_per_order != null ? 1 : 0;
    return { applicable: orders > 0, measure: 0.7 * unconfirmed + 0.3 * packaging };
  },
  payment_fees: ({ agg }) => {
    const orders = num(agg?.counts?.orders), g = agg?.dataGaps ?? {};
    return { applicable: orders > 0, measure: orders > 0 ? clamp01(1 - num(g.unconfirmed_fees) / orders) : 0 };
  },
  fixed_costs: ({ agg }) => ({ applicable: num(agg?.counts?.orders) > 0, measure: num(agg?.shop?.leaves?.fixed_costs) > 0 ? 1 : 0 }),
  landed_cost: ({ settings, lines = [] }) => {
    const eu = isEuCountry(settings?.shop_country_code);
    const known = lines.filter((l) => l?.cm1_components);
    if (!eu || !known.length) return { applicable: false, measure: 0 };
    const withDuties = known.filter((l) => l.cm1_components?.droits != null).length;
    return { applicable: true, measure: clamp01(withDuties / known.length) };
  },
  currency: ({ agg }) => ({ applicable: num(agg?.counts?.orders) > 0, measure: agg?.currency === "MIXED" ? 0 : 1 }),
};

export function dataConfidence({ agg, settings = {}, sources = {}, lines = [] } = {}) {
  const ctx = { agg, settings, sources, lines };
  const rules = [];
  let earned = 0, max = 0;
  for (const r of CONFIDENCE_RULES) {
    const m = MEASURES[r.id]?.(ctx) ?? { applicable: false, measure: 0 };
    if (!m.applicable) { rules.push({ id: r.id, applicable: false, measure: null, points: 0, max: r.weight, points_if_fixed: 0, unlocks: r.unlocks, cta: r.cta }); continue; }
    const points = r.weight * clamp01(m.measure);
    earned += points; max += r.weight;
    rules.push({ id: r.id, applicable: true, measure: clamp01(m.measure), points, max: r.weight, points_if_fixed: r.weight - points, unlocks: r.unlocks, cta: r.cta });
  }
  const score = max > 0 ? Math.round((earned / max) * 100) : 0;
  const level = CONFIDENCE_LEVELS.find((l) => score >= l.min)?.level ?? "low";
  const gaps = rules.filter((r) => r.applicable && r.points_if_fixed > 0.5).sort((a, b) => b.points_if_fixed - a.points_if_fixed);
  // Score si une règle donnée était satisfaite (« de 68 à 87 % ») ; « fees » = paiement + port confirmés.
  const if_fixed = Object.fromEntries(rules.filter((r) => r.applicable).map((r) => [r.id, max > 0 ? Math.round(((earned + r.points_if_fixed) / max) * 100) : 0]));
  const feesRules = rules.filter((r) => r.applicable && (r.id === "payment_fees" || r.id === "shipping_costs"));
  if (feesRules.length) if_fixed.fees = max > 0 ? Math.round(((earned + feesRules.reduce((s, r) => s + r.points_if_fixed, 0)) / max) * 100) : 0;
  return { score, level, rules, gaps, top_gap: gaps[0] ?? null, if_fixed, applicable_max: max };
}
