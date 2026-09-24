// ── Cascade « Où est passé votre argent ? » (F4-B, B2 ; V4, V6) : barres horizontales flottantes,
// totaux ancrés à zéro, étiquettes directes, tableau sous dépliage. HTML + CSS, aucune dépendance ;
// positions par variables de géométrie (--zero, --left, --width). ──────────────────────────────
import { useI18n } from "../../lib/i18n/context.jsx";
import { waterfallRows, waterfallGeometry } from "../../lib/charts/index.js";
import { WaterfallTable } from "../overview/Briefing.jsx";
import { Icon } from "../overview/Icons.jsx";

export function WaterfallChart({ leaves = {}, nodes = {}, gaps = {}, flags = {} }) {
  const { t, money } = useI18n();
  const rows = waterfallRows({ leaves, nodes, gaps, flags });
  const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  const g = waterfallGeometry(rows);
  const start = g.bars[0], end = g.bars[g.bars.length - 1];
  return (
    <section className="tcc-block" aria-labelledby="tcc-waterfall-title">
      <div className="tcc-block__head"><h3 id="tcc-waterfall-title">{t("overview.block.waterfall")}</h3></div>
      <div className="tcc-wf" role="img" aria-label={t("overview.waterfall.aria", { start: start?.missing ? t("common.na") : money(start?.value ?? 0), end: end?.missing ? t("common.na") : money(end?.value ?? 0) })} data-chart="waterfall">
        {g.bars.map((b) => (
          <div key={b.id} className={`tcc-wf__row is-${b.kind}${b.id === "net_result" ? " is-result" : ""}${b.missing ? " is-missing" : ""}${status[b.id] === "unconfirmed" ? " is-unconfirmed" : ""}${b.negative ? " is-negative" : ""}`} data-bar={b.id} data-status={status[b.id]}>
            <span className="tcc-wf__label">{t(`overview.calc.input.${b.id}`)}</span>
            <span className="tcc-wf__track" style={{ "--zero": g.zeroPct.toFixed(2) }}>
              {!b.missing && <i className="tcc-wf__bar" style={{ "--left": b.leftPct.toFixed(2), "--width": Math.max(b.widthPct, 0.4).toFixed(2) }} />}
            </span>
            <span className="tcc-wf__amount">{b.missing ? (status[b.id] === "unavailable" ? t("overview.waterfall.unavailable") : t("overview.waterfall.missing")) : money(b.value)}{status[b.id] === "unconfirmed" && <span className="tcc-badge tcc-badge--warn">{t("overview.waterfall.unconfirmed")}</span>}</span>
          </div>
        ))}
      </div>
      <details className="tcc-fold">
        <summary>{t("overview.waterfall.table")}<Icon id="soon" /></summary>
        <div className="tcc-fold__body"><WaterfallTable rows={rows} bare /></div>
      </details>
    </section>
  );
}
