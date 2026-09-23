// ── Niveau de confiance d'un insight (§3.3 Phase 0) — PUR, règles de décision ─────────────────
//   confirmed  : nœuds ok sur les périodes utilisées, minData satisfait, trous ≤ 10 % du CA,
//                part expliquée ≥ 80 %, référence ≥ 4 périodes (ou pas de comparaison)
//   likely     : minData satisfait ; trous ≤ 30 % ou part expliquée 50-80 % ; ou référence < 4 périodes
//   to_verify  : minData non satisfait, ou trous > 30 %, ou part expliquée < 50 %
//   simulation : toute sortie du simulateur (posé par l'appelant)
import { STATUS_RULES, RULE_MIN_DATA } from "./config.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Part du CA touchée par un trou de données (coûts inconnus, frais/port non confirmés).
export function gapsShare(agg) {
  const l = agg?.shop?.leaves ?? {}, g = agg?.dataGaps ?? {};
  const ca = num(l.known_ca_ht) + num(l.unknown_ca_ht);
  if (!(ca > 0)) return 1;
  const unknown = num(l.unknown_ca_ht) / ca;
  const orders = num(agg?.counts?.orders);
  const unconfirmed = orders > 0 ? Math.min(1, (num(g.unconfirmed_fees) + num(g.unconfirmed_shipping)) / (2 * orders)) : 0;
  // Frais/port non confirmés : précision seulement (poids 0,25), les coûts inconnus pèsent plein.
  return Math.min(1, unknown + unconfirmed * 0.25);
}

// minData d'une règle satisfait ? Renvoie { ok, missing }.
export function ruleMinData(ruleId, counts = {}) {
  const need = RULE_MIN_DATA[ruleId] ?? {};
  const missing = {};
  for (const [k, min] of Object.entries(need)) { const have = num(counts[k]); if (have < min) missing[k] = min - have; }
  return { ok: Object.keys(missing).length === 0, missing };
}

export function insightStatus({ minDataOk = true, gaps = 0, explained = null, usesReference = false, referenceCount = 0, nodesOk = true } = {}) {
  if (!minDataOk || !nodesOk) return "to_verify";
  if (gaps > STATUS_RULES.gaps_likely) return "to_verify";
  if (explained != null && explained < STATUS_RULES.explained_likely) return "to_verify";
  const confirmed = gaps <= STATUS_RULES.gaps_confirmed
    && (explained == null || explained >= STATUS_RULES.explained_confirmed)
    && (!usesReference || referenceCount >= STATUS_RULES.reference_periods_confirmed);
  return confirmed ? "confirmed" : "likely";
}
