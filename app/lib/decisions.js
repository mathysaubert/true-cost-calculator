// ── Mémoire des décisions (I0-C, D7a) — PUR : lignes à écrire, jamais d'I/O ─────────────────────
// insight_log  : ce que le copilote a montré (priorités 1-3, opportunité rang 0), par empreinte.
// decision_log : ce que le marchand a fait (scénario retenu, correction de donnée, …).
// Aucune donnée nominative : identifiants de règles, agrégats, empreintes, gid produit.
import { DECISION_KINDS } from "./schema.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// Empreinte de l'opportunité affichée : règle + sujet + fenêtre + impact mensuel arrondi (D7).
export function opportunityFingerprint(opp, window = {}) {
  if (!opp) return null;
  const v = opp.impact?.point == null ? "na" : Math.round(opp.impact.point);
  return `${opp.id}:opportunity:${opp.subject?.key ?? "shop"}:${window.start ?? ""}:${window.end ?? ""}:${v}`;
}

// Charge utile conservée : l'insight complet moins ce qui se recalcule (agrégats seulement).
function payloadOf(i, extra = {}) {
  const { vars = {}, evidence = [], impact = null, cause = null, explained = null, gaps_share = null, cta = null, lever = null, unlocks = [], kind = null } = i;
  return { kind, vars, evidence, impact, cause, explained, gaps_share, cta, lever, unlocks, ...extra };
}

// Lignes insight_log pour un briefing rendu : priorités (rang 1-3) + opportunité (rang 0).
export function insightLogRows({ briefing, window = {}, currency = null, confidenceScore = null } = {}) {
  if (!briefing) return [];
  const rows = [];
  for (const p of briefing.priorities ?? []) {
    rows.push({
      fingerprint: p.fingerprint, rule_id: p.id, subject_kind: p.subject?.kind ?? "shop", subject_key: p.subject?.key ?? "shop",
      status: p.status, rank: p.rank ?? null, window_start: window.start ?? null, window_end: window.end ?? null,
      impact_low: round2(num(p.impact?.range?.low)), impact_high: round2(num(p.impact?.range?.high)), currency_code: currency,
      payload: payloadOf(p, { confidence_score: confidenceScore }),
    });
  }
  const o = briefing.opportunity;
  if (o) {
    rows.push({
      fingerprint: opportunityFingerprint(o, window), rule_id: o.id, subject_kind: o.subject?.kind ?? "shop", subject_key: o.subject?.key ?? "shop",
      status: "simulation", rank: 0, window_start: window.start ?? null, window_end: window.end ?? null,
      impact_low: round2(num(o.impact?.low)), impact_high: round2(num(o.impact?.high)), currency_code: currency,
      payload: { kind: "opportunity", vars: o.vars ?? {}, evidence: o.evidence ?? [], impact: o.impact ?? null, scenario: scenarioFromOpportunity(o), confidence_score: confidenceScore },
    });
  }
  return rows.filter((r) => r.fingerprint);
}

// Scénario d'une opportunité : leviers, hypothèses, nœud, avant / après (ce que le simulateur rejouera).
export function scenarioFromOpportunity(o) {
  if (!o) return null;
  return { rule_id: o.id, levers: o.levers ?? {}, assumptions: (o.assumptions ?? []).map((a) => a.key ?? a), node: o.node ?? "cm2", before: num(o.before), after: num(o.after) };
}

// Règles de données précédemment montrées (lignes ouvertes) qui ne sont plus détectées : corrigées.
// open : lignes insight_log { rule_id, fingerprint, payload } avec resolved_at NULL ; insights : briefing.insights.
export function resolvedDataRules({ open = [], insights = [] } = {}) {
  const still = new Set(insights.filter((i) => i.kind === "data").map((i) => i.id));
  const byRule = new Map();
  for (const r of open) {
    if (still.has(r.rule_id)) continue;
    const e = byRule.get(r.rule_id) ?? { rule_id: r.rule_id, fingerprints: [], score_before: null };
    e.fingerprints.push(r.fingerprint);
    const s = num(r.payload?.confidence_score);
    if (s != null) e.score_before = e.score_before == null ? s : Math.min(e.score_before, s);
    byRule.set(r.rule_id, e);
  }
  return [...byRule.values()];
}

// Ligne decision_log validée (kind ∈ DECISION_KINDS). Lève sur un kind inconnu : jamais d'écriture floue.
export function decisionRow({ shop, kind, insightFingerprint = null, scenario = {}, expected = {}, horizonDays = null, note = null, reviewAt = null } = {}) {
  if (!shop) throw new Error("decision_log : boutique manquante");
  if (!DECISION_KINDS.includes(kind)) throw new Error(`decision_log : kind inconnu « ${kind} »`);
  return {
    shop_domain: shop, insight_fingerprint: insightFingerprint, kind, scenario: scenario ?? {},
    expected_impact_low: round2(num(expected.low)), expected_impact_high: round2(num(expected.high)), expected_node: expected.node ?? null,
    horizon_days: horizonDays == null ? null : Math.round(horizonDays), review_at: reviewAt, note,
  };
}

// Décision « scénario retenu » depuis l'opportunité affichée (horizon mois = 30 jours, D2b).
export function simulatedDecision({ shop, opportunity, window = {}, note = null } = {}) {
  return decisionRow({
    shop, kind: "simulated", insightFingerprint: opportunityFingerprint(opportunity, window), scenario: scenarioFromOpportunity(opportunity),
    expected: { low: opportunity?.impact?.low, high: opportunity?.impact?.high, node: opportunity?.node ?? "cm2" }, horizonDays: 30, note,
  });
}

// Décision « donnée corrigée » déduite d'une règle de données qui a disparu.
export function dataFixedDecision({ shop, resolved, scoreAfter = null } = {}) {
  return decisionRow({
    shop, kind: "data_fixed", insightFingerprint: resolved.fingerprints[0] ?? null,
    scenario: { rule_id: resolved.rule_id, fingerprints: resolved.fingerprints, score_before: resolved.score_before, score_after: scoreAfter },
  });
}
