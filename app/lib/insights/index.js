// ── Couche narrative (I0) — point d'entrée PUR : buildBriefing ────────────────────────────────
// Entrées : sorties du moteur (aggregate courante + périodes précédentes), réglages, fenêtre,
// fiabilité (app/lib/confidence.js). Sortie : les 3 résultats, « Votre situation », les 3
// priorités, l'opportunité principale, tous les insights, le pont, la référence. Aucune lecture
// de base, aucune phrase : clés + variables ; aucun chiffre hors du moteur (les impacts sont des
// formules déclarées sur des valeurs du moteur, copiées dans `evidence`).
import { simulate } from "../econ/simulate.js";
import { thresholds as computeThresholds } from "../econ/thresholds.js";
import { RULES } from "./rules.js";
import { buildReference } from "./reference.js";
import { contributionBridge } from "./bridge.js";
import { impactRange } from "./impact.js";
import { insightStatus, ruleMinData, gapsShare } from "./status.js";
import { selectPriorities } from "./priority.js";
import { buildSituation } from "./situation.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

function detectSources(agg) {
  const lv = agg?.shop?.leaves ?? {};
  return { ads: num(lv.ad_spend) > 0 || num(lv.commissions) > 0, sessions: num(agg?.counts?.sessions) > 0, customers: num(agg?.counts?.customers) > 0 };
}

// Empreinte stable : règle + sujet + fenêtre + valeur d'impact arrondie (dédoublonnage de la mémoire, D7).
export function fingerprint(insight, window) {
  const v = insight.impact?.point == null ? "na" : Math.round(insight.impact.point);
  return `${insight.id}:${insight.subject.kind}:${insight.subject.key}:${window?.start ?? ""}:${window?.end ?? ""}:${v}`;
}

// Les 3 résultats essentiels (D9 : résultat estimé même sans coûts fixes, marqué).
export function buildResults({ current, settings = {}, sources } = {}) {
  const n = current?.shop?.nodes ?? {}, l = current?.shop?.leaves ?? {}, c = current?.counts ?? {};
  const orders = num(c.orders) ?? 0;
  const one = (id, value, unit, extra = {}) => ({ id, unit, ...(orders === 0 ? { status: "insufficient", value: null, missing: { orders: 1 } } : value == null ? { status: "unknown", value: null, gap: extra.gap ?? "costs" } : { status: "ok", value }), ...extra });
  const fixedMissing = !(num(l.fixed_costs) > 0);
  const noAds = !sources?.ads;
  return {
    ca_ht: one("ca_ht", n.ca_ht, "money", { refunds: num(l.rembours) > 0 ? { refunded: l.rembours, gross: l.ca_brut } : null }),
    cm2: one("cm2", n.cm2, "money", { pct: n.cm2_pct, known_share: l.known_ca_ht != null && n.ca_ht > 0 ? (l.known_ca_ht / n.ca_ht) * 100 : null }),
    net_result: one("net_result", n.net_result, "money", { estimated: fixedMissing || noAds, gap: fixedMissing ? "fixed_costs" : null, notes: [fixedMissing ? "no_fixed_costs" : null, noAds ? "no_ad_source" : null].filter(Boolean) }),
  };
}

// Opportunité principale : la règle d'opportunité au meilleur impact × confiance, simulée avec le
// levier déclaré ; horizon mensuel (D2b), fourchette liée au score (D2a), statut « simulation ».
export function buildOpportunity({ insights = [], current, score, periodDays, currency } = {}) {
  const candidates = insights.filter((i) => i.kind === "opportunity" && i.status !== "partial" && i.simulation?.levers);
  if (!candidates.length) return null;
  const leaves = current.shop.leaves;
  const scored = candidates.map((i) => {
    const sim = simulate({ inputs: leaves, levers: i.simulation.levers });
    const node = i.simulation.node ?? "cm2";
    const delta = sim.delta?.[node] ?? null;
    return { insight: i, sim, node, delta };
  }).filter((x) => x.delta != null && x.delta > 0);
  if (!scored.length) return null;
  const confValue = { confirmed: 1, likely: 0.7, to_verify: 0.3 };
  scored.sort((a, b) => b.delta * (confValue[b.insight.status] ?? 0.3) - a.delta * (confValue[a.insight.status] ?? 0.3));
  const best = scored[0];
  return {
    id: best.insight.id, subject: best.insight.subject, status: "simulation",
    levers: best.sim.levers, assumptions: best.sim.assumptions, node: best.node,
    before: best.sim.before[best.node], after: best.sim.after[best.node],
    impact: impactRange({ point: best.delta, score, status: "simulation", currency, horizon: "month", periodDays }),
    vars: { ...best.insight.vars },
    evidence: best.insight.evidence,
    cta: best.insight.cta,
    fingerprint: `${best.insight.id}:opportunity`,
  };
}

// insights : règles évaluées, chacune enrichie de statut, impact en fourchette, sujet, CTA.
export function buildInsights({ current, reference, bridgeCm2, settings = {}, sources, score, scoreIfFixed, currency, periodDays, variantCosts } = {}) {
  const th = computeThresholds(current?.shop?.nodes ?? {}, { fixed_costs_monthly: null, marketing_monthly: null });
  const gaps = gapsShare(current);
  const ctx = { current, reference, bridgeCm2, settings, sources, score, scoreIfFixed, thresholds: th, variantCosts };
  const out = [];
  for (const rule of RULES) {
    if (rule.needs?.includes("ads") && !sources?.ads) continue;
    const md = ruleMinData(rule.id, current?.counts ?? {});
    let signal = null;
    try { signal = rule.detect(ctx); } catch { signal = null; }
    if (!signal) continue;
    const subject = { kind: rule.subject, key: signal.subjectKey ?? "shop" };
    if (!md.ok) {
      out.push({ id: rule.id, kind: rule.kind, subject, status: "partial", missing: md.missing, vars: signal.vars, evidence: signal.evidence, impact: null, cause: null, simulation: null, cta: rule.cta, lever: rule.lever, urgency: signal.urgency, ease: signal.ease, reversibility: signal.reversibility, unlocks: signal.unlocks ?? [] });
      continue;
    }
    const usesReference = rule.usesReference === true;
    const status = insightStatus({ minDataOk: true, gaps, explained: signal.explained ?? null, usesReference, referenceCount: reference?.count ?? 0 });
    const point = signal.impact?.point ?? null;
    out.push({
      id: rule.id, kind: rule.kind, subject, status,
      reference: usesReference && reference ? { kind: reference.kind, count: reference.count, periodDays } : null,
      vars: signal.vars, evidence: signal.evidence,
      impact: point == null ? { formula: signal.impact?.formula ?? null, point: null, range: null, precision_only: signal.impact?.precision_only === true } : { formula: signal.impact.formula, point, precision_only: signal.impact.precision_only === true, range: impactRange({ point, score, status, currency, horizon: "period", periodDays }) },
      cause: signal.cause ?? null, explained: signal.explained ?? null,
      simulation: signal.simulation ? { ...signal.simulation, status: "simulation" } : null,
      cta: rule.cta, lever: rule.lever, unlocks: signal.unlocks ?? [],
      urgency: signal.urgency, ease: signal.ease, reversibility: signal.reversibility,
      gaps_share: round1(gaps * 100),
    });
  }
  return out;
}

// previousPeriods : agrégats des périodes précédentes (récente → ancienne) ; confidence : sortie de
// app/lib/confidence.js ({ score, level, top_gap, if_fixed }).
export function buildBriefing({ current, previousPeriods = [], settings = {}, window = {}, confidence = null, variantCosts = null } = {}) {
  const periodDays = window?.start && window?.end ? Math.round((Date.parse(window.end) - Date.parse(window.start)) / 86_400_000) + 1 : 30;
  const currency = current?.currency ?? settings.shop_currency ?? null;
  const sources = detectSources(current);
  const reference = buildReference({ periods: previousPeriods, periodDays });
  const bridgeCm2 = contributionBridge(current?.shop?.leaves ?? {}, reference.leaves ?? {}, "cm2");
  const bridgeCm3 = contributionBridge(current?.shop?.leaves ?? {}, reference.leaves ?? {}, "cm3");
  const score = confidence?.score ?? 0;
  const insights = buildInsights({ current, reference, bridgeCm2, settings, sources, score, scoreIfFixed: confidence?.if_fixed ?? {}, currency, periodDays, variantCosts })
    .map((i) => ({ ...i, fingerprint: fingerprint(i, window) }));
  const results = buildResults({ current, settings, sources });
  const { priorities, ranked } = selectPriorities(insights, { caHt: num(current?.shop?.nodes?.ca_ht) });
  const opportunity = buildOpportunity({ insights, current, score, periodDays, currency });
  const situation = buildSituation({ current, reference, bridgeCm2, results, priorities, confidence, window });
  return { window, periodDays, currency, sources, reference, bridge: { cm2: bridgeCm2, cm3: bridgeCm3 }, results, situation, priorities, opportunity, insights, ranked: ranked.map((i) => ({ id: i.id, subject: i.subject, status: i.status, score: i.score })) };
}
