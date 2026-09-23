// ── Fonction de priorité et sélection des 3 priorités (§3.6 Phase 0, D11) — PUR ──────────────
// score = w.impact × impact_norm + w.urgency × urgence + w.confidence × confiance + w.ease × facilité
//       + w.reversibility × réversibilité ; impact_norm = min(1, |impact| / CA HT), sinon défaut par kind.
// Exclusions : une priorité par sujet ; au plus une règle de données ; jamais deux règles sur le
// même levier ; les règles de contexte ne sont retenues qu'à défaut.
import { PRIORITY_WEIGHTS, PRIORITY_COUNT, IMPACT_NORM_DEFAULT, CONFIDENCE_VALUE } from "./config.js";

export function priorityScore(insight, { caHt = null, weights = PRIORITY_WEIGHTS } = {}) {
  const point = insight.impact?.point;
  const impactNorm = point != null && Number.isFinite(point) && caHt > 0
    ? Math.min(1, Math.abs(point) / caHt)
    : (IMPACT_NORM_DEFAULT[insight.kind] ?? 0);
  const parts = {
    impact: impactNorm,
    urgency: insight.urgency ?? 0,
    confidence: CONFIDENCE_VALUE[insight.status] ?? 0,
    ease: insight.ease ?? 0,
    reversibility: insight.reversibility ?? 0,
  };
  const total = Object.entries(weights).reduce((s, [k, w]) => s + w * (parts[k] ?? 0), 0);
  return { ...parts, total };
}

export function selectPriorities(insights = [], { caHt = null, count = PRIORITY_COUNT, weights = PRIORITY_WEIGHTS } = {}) {
  const scored = insights
    .filter((i) => i.status !== "partial")
    .map((i) => ({ ...i, score: priorityScore(i, { caHt, weights }) }))
    .sort((a, b) => b.score.total - a.score.total || a.id.localeCompare(b.id));
  const chosen = [];
  const subjects = new Set(), levers = new Set();
  let dataCount = 0;
  const pick = (allowContext) => {
    for (const i of scored) {
      if (chosen.length >= count || chosen.includes(i)) continue;
      if (!allowContext && i.kind === "context") continue;
      const subjectKey = `${i.subject.kind}:${i.subject.key}`;
      if (i.subject.kind === "product" && subjects.has(subjectKey)) continue;
      if (i.kind === "data" && dataCount >= 1) continue;
      if (i.lever && levers.has(i.lever)) continue;
      chosen.push(i); subjects.add(subjectKey); if (i.lever) levers.add(i.lever); if (i.kind === "data") dataCount++;
    }
  };
  pick(false); pick(true);
  return { priorities: chosen.map((i, idx) => ({ ...i, rank: idx + 1 })), ranked: scored };
}
