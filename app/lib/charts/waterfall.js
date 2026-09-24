// ── Graphiques (F4-B, B0) — cascade horizontale, PUR ──────────────────────────────────────────
// rows : [{ id, op: "" | "−" | "=", value }] (mêmes lignes que le tableau WATERFALL_ROWS).
// Barres flottantes : une ligne « − » part du total courant et descend ; une ligne « = » est un
// total ancré à 0. Sortie en % de la largeur (le composant pose les barres en HTML/SVG).
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export function waterfallGeometry(rows = []) {
  let running = 0;
  const bars = [];
  for (const r of rows) {
    const v = num(r.value);
    if (r.op === "=") { const total = v ?? running; bars.push({ id: r.id, kind: "total", from: 0, to: total, value: total, missing: v == null }); running = total; continue; }
    if (r.op === "−") { if (v == null) { bars.push({ id: r.id, kind: "cost", from: running, to: running, value: null, missing: true }); continue; } bars.push({ id: r.id, kind: "cost", from: running - v, to: running, value: -v, missing: false }); running -= v; continue; }
    const start = v ?? 0; bars.push({ id: r.id, kind: "start", from: 0, to: start, value: start, missing: v == null }); running = start;
  }
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
  const span = hi - lo || 1;
  const pct = (v) => ((v - lo) / span) * 100;
  return { lo, hi, zeroPct: pct(0), bars: bars.map((b) => ({ ...b, leftPct: pct(Math.min(b.from, b.to)), widthPct: Math.abs(pct(b.to) - pct(b.from)), negative: b.kind === "total" && b.value < 0 })) };
}
