// ── Tuile KPI (direction B « Signal ») — PUR, rendable seule (render_check) ──────────────────
// kpi = entrée de buildKpis. Icône dans un carré teinté, libellé, gros chiffre (locale + devise),
// badge d'écart (flèche + ton + texte), mini-courbe, statuts explicites, « Voir le calcul »
// (s-modal Polaris avec un bloc de calcul maison). Aucune couleur ni chaîne en dur.
import { useI18n } from "../../lib/i18n/context.jsx";
import { Icon, ArrowIcon } from "./Icons.jsx";
import { Sparkline } from "./Sparkline.jsx";

const HERO = new Set(["ca_ht", "cm2_pct", "cac_global"]);

function statusText(kpi, t) {
  if (kpi.status === "insufficient") {
    const needs = Object.entries(kpi.missing ?? {}).map(([k, n]) => t(`overview.missing.${k}`, { count: n })).join(", ");
    return t("overview.status.insufficient", { needs });
  }
  if (kpi.status === "unknown") {
    return kpi.reason === "costs" && kpi.unknown_cost_lines > 0
      ? t("overview.status.unknown_costs", { count: kpi.unknown_cost_lines })
      : t("overview.status.unknown");
  }
  if (kpi.status === "unavailable") return t(`overview.status.unavailable.${kpi.source}`);
  return null;
}

export function CalcBlock({ kpi, label }) {
  const { t, byUnit } = useI18n();
  return (
    <div className="tcc tcc-calc">
      <p className="tcc-calc__formula">{t(`overview.kpi.${kpi.id}.help`)}</p>
      <div className="tcc-calc__rows">
        {(kpi.calc ?? []).map((row, i) => (
          <div key={`${row.id}-${i}`} className={`tcc-calc__row${row.strong ? " is-strong" : ""}`}>
            <span className="tcc-calc__op" aria-hidden="true">{row.op}</span>
            <span>{t(`overview.calc.input.${row.id}`)}</span>
            <span className="tcc-calc__amount">{row.value == null ? t("common.na") : byUnit(row.value, row.unit)}</span>
          </div>
        ))}
      </div>
      <p className="tcc-calc__note">{t("overview.calc.note", { label })}</p>
    </div>
  );
}

export function KpiTile({ kpi, index = 0 }) {
  const { t, byUnit, delta: fmtDelta, int } = useI18n();
  if (!kpi) return null;
  const label = t(`overview.kpi.${kpi.id}.label`);
  const modalId = `calc-${kpi.id}`;
  const value = kpi.status === "ok" ? byUnit(kpi.value, kpi.unit) : null;
  const status = statusText(kpi, t);
  const d = kpi.delta;
  const cls = ["tcc-tile", `is-${kpi.status}`, HERO.has(kpi.id) ? "is-hero" : "", kpi.primary ? "" : "is-secondary"].filter(Boolean).join(" ");
  const sparkTitle = kpi.series ? t("overview.spark.title", { label, count: int(kpi.series.length) }) : null;

  return (
    <article className={cls} data-kpi={kpi.id} data-i={index} data-refunded={kpi.refunds?.full ? "full" : undefined}>
      <header className="tcc-tile__head">
        <span className="tcc-tile__icon"><Icon id={kpi.id} /></span>
        <h3 className="tcc-tile__label">{label}</h3>
      </header>
      {value != null
        ? <div className="tcc-tile__value">{value}</div>
        : <p className="tcc-tile__status"><strong>{status ?? t("common.na")}</strong></p>}
      {value != null && kpi.refunds && (
        <p className={`tcc-tile__sub${kpi.refunds.full ? " is-full" : ""}`}>{kpi.refunds.discounts > 0 ? t("overview.tile.refunds_discounts", { refunded: byUnit(kpi.refunds.refunded, "money"), gross: byUnit(kpi.refunds.gross, "money"), discounts: byUnit(kpi.refunds.discounts, "money") }) : t("overview.tile.refunds", { refunded: byUnit(kpi.refunds.refunded, "money"), gross: byUnit(kpi.refunds.gross, "money") })}</p>
      )}
      <div className="tcc-tile__meta">
        {d && (
          <>
            <span className={`tcc-delta tcc-delta--${d.tone}`}><ArrowIcon direction={d.direction} />{fmtDelta(d.value, { kind: d.kind })}</span>
            <span>{t("overview.delta.vs_prev")}</span>
          </>
        )}
        {value != null && !d && <span>{t("overview.delta.none")}</span>}
      </div>
      {kpi.series ? <Sparkline points={kpi.series} previous={kpi.previousSeries ?? null} title={sparkTitle} gradientId={`tcc-spark-${kpi.id}`} /> : <span aria-hidden="true" />}
      <footer className="tcc-tile__foot">
        <s-button variant="tertiary" commandFor={modalId} command="--show">{t("overview.calc.open")}</s-button>
      </footer>
      <s-modal id={modalId} heading={t("overview.calc.title", { label })}>
        <CalcBlock kpi={kpi} label={label} />
        <s-button slot="secondary-actions" commandFor={modalId} command="--hide">{t("overview.calc.close")}</s-button>
      </s-modal>
    </article>
  );
}
