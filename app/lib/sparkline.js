// ── Mini-courbe : géométrie SVG — PUR (aucun React), testable dans les lots ──────────────────
// points : [{ day, value }] (value null = jour non défini : la courbe s'interrompt). Moins de deux
// points définis → null (le composant ne rend rien). Base 0 incluse dans l'échelle (un vrai zéro
// touche le bas). Sortie : { line, area } en coordonnées du viewBox 100 × 32.
export const SPARK_W = 100, SPARK_H = 32, SPARK_PAD = 2;

export function sparklinePaths(points = []) {
  const vals = points.map((p) => p?.value).filter((v) => v != null);
  if (points.length < 2 || vals.length < 2) return null;
  const min = Math.min(0, ...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const x = (i) => SPARK_PAD + (i / (points.length - 1)) * (SPARK_W - SPARK_PAD * 2);
  const y = (v) => SPARK_PAD + (1 - (v - min) / range) * (SPARK_H - SPARK_PAD * 2);
  let line = "", area = "", open = false, lastX = null;
  points.forEach((p, i) => {
    if (p?.value == null) { if (open) { area += ` L${lastX.toFixed(1)},${SPARK_H} Z`; open = false; } return; }
    const px = x(i), py = y(p.value);
    if (!open) { line += `${line ? " " : ""}M${px.toFixed(1)},${py.toFixed(1)}`; area += `${area ? " " : ""}M${px.toFixed(1)},${SPARK_H} L${px.toFixed(1)},${py.toFixed(1)}`; open = true; }
    else { line += ` L${px.toFixed(1)},${py.toFixed(1)}`; area += ` L${px.toFixed(1)},${py.toFixed(1)}`; }
    lastX = px;
  });
  if (open) area += ` L${lastX.toFixed(1)},${SPARK_H} Z`;
  return { line, area };
}
