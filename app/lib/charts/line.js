// ── Graphiques (F4-B, B0) — courbes multi-séries avec trous, PUR ──────────────────────────────
// points : [{ day, value }] ; value null = pas de donnée (trait interrompu, jamais un zéro).
// Sortie en coordonnées du viewBox (W × H) ; le composant pose les axes en HTML autour.
import { niceDomain, linearScale, indexScale, labelIndices } from "./scale.js";

export const CHART_W = 600, CHART_H = 200, CHART_PAD = { top: 8, right: 8, bottom: 4, left: 4 };
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const fx = (v) => (Math.round(v * 10) / 10).toFixed(1);

// Étendue commune de plusieurs séries (0 inclus).
export function seriesExtent(seriesList = []) {
  let min = Infinity, max = -Infinity;
  for (const s of seriesList) for (const p of s ?? []) { const v = num(p?.value); if (v == null) continue; if (v < min) min = v; if (v > max) max = v; }
  if (min === Infinity) return { min: 0, max: 0, empty: true };
  return { min: Math.min(0, min), max: Math.max(0, max), empty: false };
}

// Tracé ligne + aire d'une série sur des échelles données ; trous respectés.
export function linePath(points = [], x, y, baselineY) {
  let line = "", area = "", open = false, lastX = null;
  const out = [];
  points.forEach((p, i) => {
    const v = num(p?.value);
    if (v == null) { if (open) { area += ` L${fx(lastX)},${fx(baselineY)} Z`; open = false; } out.push({ i, x: x(i), y: null, value: null, day: p?.day ?? null }); return; }
    const px = x(i), py = y(v);
    if (!open) { line += `${line ? " " : ""}M${fx(px)},${fx(py)}`; area += `${area ? " " : ""}M${fx(px)},${fx(baselineY)} L${fx(px)},${fx(py)}`; open = true; }
    else { line += ` L${fx(px)},${fx(py)}`; area += ` L${fx(px)},${fx(py)}`; }
    lastX = px; out.push({ i, x: px, y: py, value: v, day: p?.day ?? null });
  });
  if (open) area += ` L${fx(lastX)},${fx(baselineY)} Z`;
  return { line, area, points: out };
}

// Nombre de jours définis et non nuls d'une série (règle V8).
export function seriesCounts(points = []) {
  const defined = points.filter((p) => num(p?.value) != null).length;
  const nonZero = points.filter((p) => num(p?.value) != null && num(p?.value) !== 0).length;
  return { defined, nonZero };
}

// series : [{ id, points, ghost? }] ; ghost = période précédente (même longueur, tracé sans aire).
export function buildLineChart({ series = [], width = CHART_W, height = CHART_H, pad = CHART_PAD, tickCount = 4, maxLabels = 6 } = {}) {
  const n = Math.max(0, ...series.map((s) => s.points?.length ?? 0));
  const ext = seriesExtent(series.map((s) => s.points));
  const dom = niceDomain(ext.min, ext.max, tickCount);
  const plot = { x0: pad.left, x1: width - pad.right, y0: pad.top, y1: height - pad.bottom };
  const x = indexScale(n, [plot.x0, plot.x1]);
  const y = linearScale({ domain: [dom.min, dom.max], range: [plot.y1, plot.y0] });
  const baselineY = y(0);
  const out = series.map((s) => {
    const p = linePath(s.points ?? [], x, y, baselineY);
    const defined = p.points.filter((q) => q.value != null);
    return { id: s.id, ghost: !!s.ghost, line: p.line, area: s.ghost ? "" : p.area, points: p.points, last: defined.length ? defined[defined.length - 1] : null };
  });
  return {
    width, height, plot, n, empty: ext.empty,
    yTicks: dom.ticks.map((v) => ({ value: v, y: y(v), pct: ((y(v) - plot.y0) / (plot.y1 - plot.y0 || 1)) * 100 })),
    xLabels: labelIndices(n, maxLabels).map((i) => ({ index: i, x: x(i), pct: ((x(i) - plot.x0) / (plot.x1 - plot.x0 || 1)) * 100 })),
    baselineY, series: out,
    xPct: (i) => ((x(i) - plot.x0) / (plot.x1 - plot.x0 || 1)) * 100,
    nearest: (pct) => x.nearest(plot.x0 + (pct / 100) * (plot.x1 - plot.x0)),
  };
}
