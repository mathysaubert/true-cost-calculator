// ── Tuile KPI (F4-A) — PUR, rendable seule (render_check) ────────────────────────────────────
// kpi = entrée de buildKpis : { id, unit, status, value, delta, missing, inputs… }. Aucune chaîne
// en dur, aucune couleur : jetons Polaris (tone) + icône + texte (jamais la couleur seule).
import { useI18n } from "../../lib/i18n/context.jsx";

function statusText(kpi, i18n) {
  const { t } = i18n;
  if (kpi.status === "insufficient") {
    const needs = Object.entries(kpi.missing ?? {}).map(([k, n]) => t(`dashboard.missing.${k}`, { count: n })).join(", ");
    return t("dashboard.status.insufficient", { needs });
  }
  if (kpi.status === "unknown") {
    return kpi.reason === "costs" && kpi.unknown_cost_lines > 0
      ? t("dashboard.status.unknown_costs", { count: kpi.unknown_cost_lines })
      : t("dashboard.status.unknown");
  }
  if (kpi.status === "unavailable") return t(`dashboard.status.unavailable.${kpi.source}`);
  return null;
}

export function KpiTile({ kpi }) {
  const i18n = useI18n();
  const { t, byUnit, delta: fmtDelta } = i18n;
  if (!kpi) return null;
  const label = t(`dashboard.kpi.${kpi.id}.label`);
  const modalId = `calc-${kpi.id}`;
  const value = kpi.status === "ok" ? byUnit(kpi.value, kpi.unit) : null;
  const status = statusText(kpi, i18n);
  const d = kpi.delta;
  const deltaText = d ? fmtDelta(d.value, { kind: d.kind }) : null;
  const deltaTone = !d ? null : d.value > 0 ? "success" : d.value < 0 ? "critical" : "neutral";
  const deltaIcon = !d ? null : d.value > 0 ? "arrow-up" : d.value < 0 ? "arrow-down" : "minus";

  return (
    <s-box padding="base" background="base" borderWidth="base" borderColor="base" borderRadius="base">
      <s-stack gap="small-200">
        <s-heading>{label}</s-heading>
        {value != null ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">{value}</s-text>
            {deltaText != null && <s-badge tone={deltaTone} icon={deltaIcon}>{deltaText}</s-badge>}
            {deltaText != null && <s-text color="subdued">{t("dashboard.delta.vs_prev")}</s-text>}
          </s-stack>
        ) : (
          <s-text color="subdued">{status ?? t("common.na")}</s-text>
        )}
        {value != null && deltaText == null && <s-text color="subdued">{t("dashboard.delta.none")}</s-text>}
        <s-button variant="tertiary" commandFor={modalId} command="--show">{t("dashboard.calc.open")}</s-button>
        <s-modal id={modalId} heading={t("dashboard.calc.title", { label })}>
          <s-stack gap="base">
            <s-heading>{t("dashboard.calc.formula")}</s-heading>
            <s-paragraph>{t(`dashboard.kpi.${kpi.id}.help`)}</s-paragraph>
            <s-heading>{t("dashboard.calc.inputs")}</s-heading>
            <s-unordered-list>
              {(kpi.inputs ?? []).map((inp) => (
                <s-list-item key={inp.id}>{t(`dashboard.calc.input.${inp.id}`)}{": "}{inp.value == null ? t("common.na") : byUnit(inp.value, inp.unit)}</s-list-item>
              ))}
            </s-unordered-list>
          </s-stack>
          <s-button slot="secondary-actions" commandFor={modalId} command="--hide">{t("dashboard.calc.close")}</s-button>
        </s-modal>
      </s-stack>
    </s-box>
  );
}
