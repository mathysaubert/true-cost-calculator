// ── Référence de comparaison (D1) — PUR ──────────────────────────────────────────────────────
// periods : agrégats des périodes PRÉCÉDENTES de même longueur, de la plus récente à la plus
// ancienne (fournis par le loader). 1 période → « vs période précédente » ; 2 à 4 → moyenne
// étiquetée « vs vos N dernières semaines » ; ≥ 182 jours couverts → « vs vos 6 derniers mois ».
// Moyenne null-aware : un nœud absent d'une période est ignoré pour ce nœud (count par nœud).
import { REFERENCE_PERIODS, REFERENCE_SIX_MONTHS_DAYS } from "./config.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

export function buildReference({ periods = [], periodDays = 30 } = {}) {
  // Une période sans commande (historique non encore chargé) n'est pas une période de référence.
  // Une période sans commande (historique pas encore chargé) n'est pas une référence.
  const usable = periods.filter((p) => p?.shop?.nodes && (p.shop.leaves?.orders ?? p.counts?.orders ?? 1) > 0).slice(0, REFERENCE_PERIODS);
  if (!usable.length) return { kind: "none", count: 0, days: 0, weeks: 0, nodes: {}, leaves: {}, counts: {} };
  const avg = (getter) => {
    const out = {}; const cnt = {};
    for (const p of usable) for (const [k, v] of Object.entries(getter(p))) { const n = num(v); if (n == null) continue; out[k] = (out[k] ?? 0) + n; cnt[k] = (cnt[k] ?? 0) + 1; }
    for (const k of Object.keys(out)) out[k] = out[k] / cnt[k];
    return { values: out, counts: cnt };
  };
  const nodes = avg((p) => p.shop.nodes), leaves = avg((p) => p.shop.leaves);
  const days = usable.length * periodDays;
  const kind = usable.length === 1 ? "previous" : days >= REFERENCE_SIX_MONTHS_DAYS ? "six_months" : "periods";
  return { kind, count: usable.length, days, weeks: Math.round(days / 7), nodes: nodes.values, leaves: leaves.values, counts: nodes.counts };
}
