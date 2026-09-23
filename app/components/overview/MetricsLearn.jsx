// ── Page Indicateurs : contenu pédagogique par KPI (« En savoir plus », dépliage natif) ─────────
import { useI18n } from "../../lib/i18n/context.jsx";
import { KPI_DEFS } from "../../lib/overview.js";
import { Icon } from "./Icons.jsx";

const FIELDS = ["what", "why", "how", "watch"];

export function MetricsLearn({ defs = KPI_DEFS }) {
  const { t } = useI18n();
  return (
    <section className="tcc-block" aria-labelledby="tcc-learn-title">
      <div className="tcc-block__head"><h3 id="tcc-learn-title">{t("metrics.learn_title")}</h3></div>
      <div className="tcc-stack">
        {defs.map((d) => (
          <details key={d.id} className="tcc-fold" data-learn={d.id}>
            <summary>{t(`overview.kpi.${d.id}.label`)}<Icon id="soon" /></summary>
            <div className="tcc-fold__body">
              <dl className="tcc-learn">
                {FIELDS.map((f) => (
                  <div key={f}><dt>{t(`learn.label.${f}`)}</dt><dd>{t(`learn.kpi.${d.id}.${f}`)}</dd></div>
                ))}
              </dl>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
