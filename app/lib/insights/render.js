// ── Rendu textuel d'un insight (I0-B) — PUR, sans React ──────────────────────────────────────
// Transforme un insight (clés + variables brutes) en textes traduits : chaque variable est
// formatée selon son unité (table ci-dessous), les identifiants (facteur, motif, règle, produit)
// deviennent des libellés. Aucun chiffre calculé : formatage seulement.
const MONEY = new Set(["refunded", "gross", "discounts", "aov", "main_price", "cac", "be_cac", "landed", "price", "cm2", "net_result", "low", "high", "amount", "impact_low", "impact_high", "offset_amount"]);
const PCT = new Set(["cm2_pct", "target", "known_share", "cogs_share", "order_cost_share", "prev_cm2_pct", "share_1", "share_2", "unexplained", "refund_share", "reason_share", "unknown_share", "top_share", "discount_share", "share", "otd", "missing_share", "target_rate"]);
const SIGNED_PCT = new Set(["rev_delta", "cm2_delta", "spend_delta", "new_delta"]);
const POINTS = new Set(["delta_pts"]);
const RATIO = new Set(["roas", "be_roas", "mer"]);
const INT = new Set(["lines", "products", "orders", "units", "variants", "lead", "days", "x", "y", "count", "weeks", "score", "score_after", "points"]);

export function formatVar(name, value, i18n, { titles = {} } = {}) {
  const { t, money, pct, delta, ratio, int } = i18n;
  // Référence de comparaison : { kind, count, periodDays } ; « none » ou absente → chaîne vide.
  if (name === "reference") { const kind = typeof value === "object" && value ? value.kind : value; return kind && kind !== "none" ? t(`reference.${kind}`, typeof value === "object" ? { weeks: Math.round(((value.count ?? 1) * (value.periodDays ?? 30)) / 7) } : {}) : ""; }
  if (value == null) return t("common.na");
  if (name === "factor" || name === "factor_1" || name === "factor_2" || name === "offset") return t(`factor.${value}`);
  if (name === "reason") return t(`reason.${value}`);
  if (name === "rule") return t(`insight.${value}.name`);
  if (name === "top_gap") return t(`health.rule.${value}`);
  if (name === "gap") return t(`results.gap.${value}`);
  if (name === "product" || name === "top_product") return titles[value] ?? String(value).split("/").pop();
  if (name === "missing" && typeof value === "object") return Object.entries(value).map(([k, n]) => t(`overview.missing.${k}`, { count: n })).join(", ");
  if (MONEY.has(name)) return money(value);
  if (PCT.has(name)) return pct(value, { digits: name === "share" || name.endsWith("_share") ? 0 : 1 });
  if (SIGNED_PCT.has(name)) return delta(value, { kind: "pct" });
  // Points de pourcentage : nombre seul, l'unité « points » est portée par la phrase du catalogue.
  if (POINTS.has(name)) return i18n.number ? i18n.number(value, { digits: 1 }) : String(Math.round(value * 10) / 10);
  if (RATIO.has(name)) return ratio(value);
  if (INT.has(name)) return int(value);
  return String(value);
}

const FIELDS = ["observation", "context", "cause", "impact", "recommendation", "simulation", "followup", "partial"];

// insight : sortie de buildBriefing ; renvoie les textes disponibles (champ absent du catalogue → null).
export function renderInsight(insight, i18n, { titles = {}, reference = null } = {}) {
  const { t } = i18n;
  const vars = { ...(insight.vars ?? {}) };
  if (insight.impact?.range) { vars.low = insight.impact.range.low; vars.high = insight.impact.range.high; }
  if (insight.missing) vars.missing = insight.missing;
  vars.reference = insight.reference ?? reference ?? null;
  const fv = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, formatVar(k, v, i18n, { titles })]));
  const out = { id: insight.id, name: t(`insight.${insight.id}.name`), status: insight.status };
  for (const f of FIELDS) {
    const key = `insight.${insight.id}.${f}`;
    out[f] = t.has(key) ? t(key, fv) : null;
  }
  if (insight.status === "partial") { out.observation = out.partial ?? out.observation; out.impact = null; out.cause = null; out.simulation = null; }
  if (!insight.cause) out.cause = null;
  // Compensation : un effet en sens inverse assez fort pour être nommé (cause.offsets, seuil config).
  const off = insight.cause?.offsets?.[0] ?? null;
  out.offset = out.cause && off ? t("analysis.offset", { offset: formatVar("offset", off.factor, i18n), offset_amount: formatVar("offset_amount", off.amount, i18n) }) : null;
  if (!insight.impact?.range) out.impact = insight.impact?.formula && insight.status !== "partial" ? out.impact : null;
  const conf = insight.status === "partial" ? "to_verify" : insight.status;
  out.confidence = { key: conf, label: t(`confidence.${conf}.label`), help: t(`confidence.${conf}.help`) };
  const cta = insight.cta ?? null;
  out.cta = cta ? { kind: cta.kind, target: cta.target, label: cta.kind === "open_section" ? t("cta.open_section", { section: t(`nav.${cta.target}`) }) : t(`cta.${cta.kind}`) } : null;
  out.horizon = insight.impact?.range?.horizon === "month" ? t("impact.per_month") : t("impact.over_period");
  out.evidence = (insight.evidence ?? []).map((e) => ({ ...e, label: evidenceLabel(e.node, t), text: e.value == null ? t("common.na") : i18n.byUnit(e.value, e.unit) }));
  return out;
}

// Libellé d'un nœud de preuve : entrée de calcul, KPI, libellé dédié, sinon suffixe « _reference ».
export function evidenceLabel(node, t) {
  const base = String(node).replace(/_reference$/, "");
  const label = t.has(`overview.calc.input.${base}`) ? t(`overview.calc.input.${base}`) : t.has(`overview.kpi.${base}.label`) ? t(`overview.kpi.${base}.label`) : t.has(`evidence.${base}`) ? t(`evidence.${base}`) : base;
  return base === node ? label : t("analysis.evidence_reference", { label });
}

// Phrases de « Votre situation ».
export function renderSituation(slots = [], i18n, opts = {}) {
  const { t } = i18n;
  return slots.map((s) => {
    const vars = Object.fromEntries(Object.entries(s.vars ?? {}).map(([k, v]) => [k, formatVar(k, v, i18n, opts)]));
    return { slot: s.slot, text: t(s.key, vars) };
  });
}
