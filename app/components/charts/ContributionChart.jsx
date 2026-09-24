// ── Courbe de contribution (F4-B, B1 ; V2, V3, V8) : CA HT et CM2 par jour, période précédente
// en trait pointillé neutre, légende + étiquettes directes, axe unique, réticule + infobulle au
// survol et au clavier. SVG maison (décision 8 amendée), axes en HTML, aucune dépendance. ─────
import { useState, useMemo } from "react";
import { useI18n } from "../../lib/i18n/context.jsx";
import { buildLineChart, CHART_W, CHART_H } from "../../lib/charts/index.js";
import { Icon } from "../overview/Icons.jsx";

const SERIES = [{ id: "ca_ht", tone: "revenue" }, { id: "cm2", tone: "cm2" }];

// chart : sortie de buildChartSeries ({ days, series: { ca_ht: { current, previous }, cm2: {…} }, enough, previousDays })
export function ContributionChart({ chart, days = 30 }) {
  const { t, money, day } = useI18n();
  const [hover, setHover] = useState(null);
  const model = useMemo(() => {
    if (!chart?.enough) return null;
    const list = [];
    for (const s of SERIES) {
      const cur = chart.series?.[s.id]?.current ?? [], prev = chart.series?.[s.id]?.previous ?? [];
      if (prev.length) list.push({ id: `${s.id}_prev`, points: prev, ghost: true, tone: s.tone });
      list.push({ id: s.id, points: cur, ghost: false, tone: s.tone });
    }
    return buildLineChart({ series: list });
  }, [chart]);
  if (!chart) return null;
  if (!model) {
    return (
      <section className="tcc-block" aria-labelledby="tcc-chart-title">
        <div className="tcc-block__head"><h3 id="tcc-chart-title">{t("overview.block.chart")}</h3></div>
        <div className="tcc-chart tcc-chart--empty tcc-card tcc-empty" data-chart="empty">
          <span className="tcc-slot__icon"><Icon id="chart" /></span>
          <p><strong>{t("overview.chart.empty_title")}</strong></p>
          <p>{t("overview.chart.empty_body", { count: days })}</p>
        </div>
      </section>
    );
  }
  const n = model.n;
  const idx = hover == null ? null : Math.max(0, Math.min(n - 1, hover));
  const at = (id, i) => model.series.find((s) => s.id === id)?.points[i] ?? null;
  const onMove = (e) => { const r = e.currentTarget.getBoundingClientRect(); if (!r.width) return; setHover(model.nearest(((e.clientX - r.left) / r.width) * 100)); };
  const dayLabel = (i) => (chart.days?.[i] ? day(chart.days[i]) : "");
  return (
    <section className="tcc-block" aria-labelledby="tcc-chart-title">
      <div className="tcc-block__head">
        <h3 id="tcc-chart-title">{t("overview.block.chart")}</h3>
        <ul className="tcc-legend" aria-label={t("overview.chart.legend")}>
          {SERIES.map((s) => <li key={s.id} className={`tcc-legend__item is-${s.tone}`}><span className="tcc-legend__swatch" aria-hidden="true" />{t(`overview.calc.input.${s.id}`)}</li>)}
          {chart.previousDays?.length ? <li className="tcc-legend__item is-previous"><span className="tcc-legend__swatch is-dashed" aria-hidden="true" />{t("overview.chart.previous")}</li> : null}
        </ul>
      </div>
      <div className="tcc-chart" data-chart="line" data-hover={idx ?? undefined}>
        <div className="tcc-chart__y" aria-hidden="true">
          {model.yTicks.map((tk) => <span key={tk.value} className="tcc-chart__ytick" data-pct={tk.pct.toFixed(1)} style={{ "--pct": tk.pct.toFixed(1) }}>{money(tk.value, { digits: 0 })}</span>)}
        </div>
        <div className="tcc-chart__plot" role="img" aria-label={t("overview.chart.aria", { count: n, first: dayLabel(0), last: dayLabel(n - 1) })} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg className="tcc-chart__svg" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            {model.yTicks.map((tk) => <line key={tk.value} className="tcc-chart__grid" x1={model.plot.x0} x2={model.plot.x1} y1={tk.y} y2={tk.y} vectorEffect="non-scaling-stroke" />)}
            <line className="tcc-chart__baseline" x1={model.plot.x0} x2={model.plot.x1} y1={model.baselineY} y2={model.baselineY} vectorEffect="non-scaling-stroke" />
            {model.series.filter((s) => s.ghost).map((s) => <path key={s.id} className={`tcc-chart__ghost is-${s.tone}`} d={s.line} fill="none" vectorEffect="non-scaling-stroke" />)}
            {model.series.filter((s) => !s.ghost).map((s) => (
              <g key={s.id} className={`tcc-chart__series is-${s.tone}`} data-series={s.id}>
                {s.area && <path className="tcc-chart__area" d={s.area} stroke="none" />}
                <path className="tcc-chart__line" d={s.line} fill="none" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
            {idx != null && <line className="tcc-chart__cursor" x1={model.series[0]?.points[idx]?.x ?? 0} x2={model.series[0]?.points[idx]?.x ?? 0} y1={model.plot.y0} y2={model.plot.y1} vectorEffect="non-scaling-stroke" />}
          </svg>
          {model.series.filter((s) => !s.ghost && s.last).map((s) => (
            <span key={s.id} className={`tcc-chart__marker is-${s.tone}`} data-x={model.xPct(s.last.i).toFixed(1)} data-y={(((s.last.y - model.plot.y0) / (model.plot.y1 - model.plot.y0 || 1)) * 100).toFixed(1)} style={{ "--x": model.xPct(s.last.i).toFixed(1), "--y": (((s.last.y - model.plot.y0) / (model.plot.y1 - model.plot.y0 || 1)) * 100).toFixed(1) }} aria-hidden="true">
              <b>{money(s.last.value)}</b>
            </span>
          ))}
          {idx != null && (
            <div className="tcc-chart__tip" role="status" data-x={model.xPct(idx).toFixed(1)} style={{ "--x": model.xPct(idx).toFixed(1) }}>
              <strong>{dayLabel(idx)}</strong>
              {SERIES.map((s) => {
                const cur = at(s.id, idx), prev = at(`${s.id}_prev`, idx);
                return (
                  <span key={s.id} className={`is-${s.tone}`}>
                    {t(`overview.calc.input.${s.id}`)}{" : "}{cur?.value == null ? t("common.na") : money(cur.value)}
                    {prev ? <small className="tcc-muted">{" · "}{t("overview.chart.tooltip_previous", { value: prev.value == null ? t("common.na") : money(prev.value) })}</small> : null}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <input type="range" className="tcc-chart__reader" min={0} max={Math.max(0, n - 1)} step={1} value={idx ?? 0} onChange={(e) => setHover(Number(e.target.value))} onBlur={() => setHover(null)} aria-label={t("overview.chart.reader")} aria-valuetext={dayLabel(idx ?? 0)} />
        <div className="tcc-chart__x" aria-hidden="true">
          {model.xLabels.map((l) => <span key={l.index} className="tcc-chart__xtick" data-pct={l.pct.toFixed(1)} style={{ "--pct": l.pct.toFixed(1) }}>{dayLabel(l.index)}</span>)}
        </div>
      </div>
      <p className="tcc-muted tcc-chart__hint">{t("overview.chart.hint")}{chart.partialCm2 ? ` ${t("overview.chart.partial")}` : ""}</p>
    </section>
  );
}
