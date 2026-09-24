// ── Graphiques (F4-B, décision 8 amendée le 2026-09-24) — point d'entrée PUR, zéro dépendance ──
export { niceStep, niceDomain, linearScale, indexScale, labelIndices } from "./scale.js";
export { CHART_W, CHART_H, CHART_PAD, seriesExtent, linePath, seriesCounts, buildLineChart } from "./line.js";
export { waterfallGeometry } from "./waterfall.js";

// Couleurs de séries validées par le validateur du guide dataviz (clair sur #ffffff, sombre sur
// #171a20) le 2026-09-24 ; le lot 31 vérifie que la feuille de style porte exactement ces valeurs.
export const CHART_COLORS = {
  light: { revenue: "#2a78d6", cm2: "#4a3aa7", previous: "#8a8f9a" },
  dark:  { revenue: "#3987e5", cm2: "#c05ac8", previous: "#8a8f9a" },
};
