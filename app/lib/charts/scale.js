// ── Graphiques (F4-B, B0) — échelles et graduations, PUR ──────────────────────────────────────
// Aucune dépendance : échelle linéaire avec inversion, domaine « joli » (pas 1 / 2 / 5 × 10^k),
// échelle d'index (jours équidistants). Les valeurs monétaires incluent toujours 0 dans le domaine.
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Pas « joli » ≥ raw parmi 1, 2, 5 × 10^k.
export function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}

// Domaine étendu à des multiples du pas ; count = nombre de graduations visé (≈ 4-6).
export function niceDomain(min, max, count = 5, { includeZero = true } = {}) {
  let lo = num(min) ?? 0, hi = num(max) ?? 0;
  if (includeZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) { hi = lo + 1; }
  const step = niceStep((hi - lo) / Math.max(1, count - 1));
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min: a, max: b, step, ticks };
}

export function linearScale({ domain: [d0, d1], range: [r0, r1] }) {
  const span = d1 - d0 || 1;
  const f = (v) => (v == null ? null : r0 + ((v - d0) / span) * (r1 - r0));
  f.invert = (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * span;
  f.domain = [d0, d1]; f.range = [r0, r1];
  return f;
}

// n points équidistants sur [r0, r1] ; un seul point → milieu.
export function indexScale(n, [r0, r1]) {
  const f = (i) => (n <= 1 ? (r0 + r1) / 2 : r0 + (i / (n - 1)) * (r1 - r0));
  f.nearest = (p) => (n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((p - r0) / (r1 - r0 || 1)) * (n - 1)))));
  return f;
}

// Indices des étiquettes de l'axe des jours : premier, dernier, et au plus `max` intermédiaires.
export function labelIndices(n, max = 6) {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const step = Math.ceil((n - 1) / (max - 1));
  const out = [];
  for (let i = 0; i < n - 1; i += step) out.push(i);
  out.push(n - 1);
  return out;
}
