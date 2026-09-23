// ── « Votre situation » (§3.7 Phase 0) — PUR : 3 à 4 phrases, chacune une clé + variables ──────
// Créneaux : result (gagne / perd / inconnu), trend (CA vs contribution), factor (effet dominant du
// pont ou priorité 1), data (score de fiabilité et manque principal). Une phrase absente est
// remplacée par sa version « ce qu'on peut déjà dire » (variante *_partial / single_period).
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const pct = (a, b) => (a == null || b == null || !(b > 0) ? null : (a / b) * 100);

export function buildSituation({ current, reference, bridgeCm2, results, priorities = [], confidence, window } = {}) {
  const n = current?.shop?.nodes ?? {}, r = reference?.nodes ?? {};
  const slots = [];
  // 1. Résultat
  const res = results?.net_result;
  if (res?.status === "ok" && res.value != null) {
    slots.push({ slot: "result", key: res.value >= 0 ? "situation.result.positive" : "situation.result.negative", vars: { net_result: res.value, period: window, estimated: res.estimated === true } });
  } else {
    slots.push({ slot: "result", key: "situation.result.unknown", vars: { gap: res?.gap ?? null, orders: num(current?.counts?.orders) ?? 0 } });
  }
  // 2. Tendance
  if (n.ca_ht != null && r.ca_ht != null && n.cm2 != null && bridgeCm2?.reference != null && reference?.count > 0) {
    const rev = pct(n.ca_ht - r.ca_ht, r.ca_ht), cm2 = pct(n.cm2 - bridgeCm2.reference, Math.abs(bridgeCm2.reference));
    slots.push({ slot: "trend", key: rev != null && cm2 != null && rev > cm2 + 5 ? "situation.trend.diverging" : "situation.trend.aligned", vars: { rev_delta: rev, cm2_delta: cm2, reference: reference.kind, weeks: reference.weeks } });
  } else {
    slots.push({ slot: "trend", key: "situation.trend.single_period", vars: {} });
  }
  // 3. Facteur principal
  const top = bridgeCm2?.ranked?.[0];
  if (top && bridgeCm2.explained >= 0.5) {
    slots.push({ slot: "factor", key: "situation.factor", vars: { factor: top.factor, share: top.share * 100, amount: top.amount } });
  } else if (priorities[0]) {
    slots.push({ slot: "factor", key: "situation.factor_priority", vars: { rule: priorities[0].id, impact_low: priorities[0].impact?.range?.low ?? null, impact_high: priorities[0].impact?.range?.high ?? null } });
  }
  // 4. Données
  if (confidence) {
    const key = confidence.level === "high" ? "situation.data.high" : confidence.level === "medium" ? "situation.data.medium" : "situation.data.low";
    slots.push({ slot: "data", key, vars: { score: confidence.score, top_gap: confidence.top_gap?.id ?? null, points: confidence.top_gap?.points_if_fixed ?? null } });
  }
  return slots;
}
