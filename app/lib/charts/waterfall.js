// ── Graphiques (F4-B, B0) — cascade horizontale, PUR ──────────────────────────────────────────
// rows : [{ id, op: "" | "−" | "=", value }] (mêmes lignes que le tableau WATERFALL_ROWS).
// Barres flottantes : une ligne « − » part du total courant et descend ; une ligne « = » est un
// total ancré à 0. Sortie en % de la largeur (le composant pose les barres en HTML/SVG).
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Lignes de la cascade (mêmes que le tableau) : [op, id, options] ; "" = départ, "−" = coût, "=" = total.
// `unknown_ca_ht` (retour du 2026-09-24) : la CM2 ne compte que les lignes à coût connu ; le CA des
// lignes sans coût sort de la cascade par une ligne explicite, masquée quand elle vaut 0.
export const WATERFALL_SPEC = [["", "ca_ht"], ["−", "unknown_ca_ht", { optional: true }], ["−", "cogs"], ["−", "shipping_cost"], ["−", "packaging_cost"], ["−", "payment_fees"], ["−", "returns_cost"], ["=", "cm2"], ["−", "ad_spend"], ["−", "commissions"], ["=", "cm3"], ["−", "fixed_costs"], ["=", "net_result"]];

// Statut de chaque ligne, même règle que les tuiles et le bloc Résultats :
//   ok | missing (réglage absent : « non renseigné ») | unconfirmed (montant estimé, « à confirmer »)
//   | unavailable (source non connectée). gaps = agg.dataGaps ; flags = { fixed_missing,
//   packaging_missing, return_cost_missing, ads } posés par le loader depuis les réglages.
export function waterfallRows({ leaves = {}, nodes = {}, gaps = {}, flags = {} } = {}) {
  const value = (id) => (id in nodes ? num(nodes[id]) : num(leaves[id]));
  const rows = [];
  for (const [op, id, opt] of WATERFALL_SPEC) {
    const v = value(id);
    if (opt?.optional && !(v > 0)) continue;
    let status = v == null ? "missing" : "ok";
    if (id === "fixed_costs" && flags.fixed_missing === true) status = "missing";
    if (id === "packaging_cost" && (flags.packaging_missing === true || num(gaps.no_packaging_cost) > 0)) status = "missing";
    if (id === "shipping_cost" && num(gaps.unconfirmed_shipping) > 0) status = v > 0 ? "unconfirmed" : "missing";
    if (id === "payment_fees" && num(gaps.unconfirmed_fees) > 0) status = v > 0 ? "unconfirmed" : "missing";
    if (id === "returns_cost" && flags.return_cost_missing === true && num(leaves.rembours) > 0) status = "missing";
    if (id === "ad_spend" && flags.ads === false) status = "unavailable";
    rows.push({ id, op, value: status === "missing" || status === "unavailable" ? null : v, status });
  }
  return rows;
}

export function waterfallGeometry(rows = []) {
  let running = 0;
  const bars = [];
  for (const r of rows) {
    const v = num(r.value);
    if (r.op === "=") { const total = v ?? running; bars.push({ id: r.id, kind: "total", from: 0, to: total, value: total, missing: v == null }); running = total; continue; }
    if (r.op === "−") { if (v == null) { bars.push({ id: r.id, kind: "cost", from: running, to: running, value: null, missing: true }); continue; } bars.push({ id: r.id, kind: "cost", from: running - v, to: running, value: v === 0 ? 0 : -v, missing: false }); running -= v; continue; }
    const start = v ?? 0; bars.push({ id: r.id, kind: "start", from: 0, to: start, value: start, missing: v == null }); running = start;
  }
  const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map((b) => Math.max(b.from, b.to)));
  const span = hi - lo || 1;
  const pct = (v) => ((v - lo) / span) * 100;
  return { lo, hi, zeroPct: pct(0), bars: bars.map((b) => ({ ...b, leftPct: pct(Math.min(b.from, b.to)), widthPct: Math.abs(pct(b.to) - pct(b.from)), negative: b.kind === "total" && b.value < 0 })) };
}
