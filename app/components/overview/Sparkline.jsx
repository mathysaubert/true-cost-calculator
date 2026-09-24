// ── Mini-courbe SVG maison (une série, aplat dégradé sous la courbe, sans axes) — PUR ─────────
// Géométrie dans app/lib/sparkline.js (testée au lot 26). Couleur : currentColor (teinte de section
// ou d'état). Titre accessible fourni par le parent (déjà traduit). Jamais rendue si la série est vide.
import { sparklinePaths, SPARK_W, SPARK_H } from "../../lib/sparkline.js";

// previous : période précédente alignée (trait fantôme pointillé, V5) ; le point final est un trait
// de longueur nulle à bouts ronds en `non-scaling-stroke` : un disque de 8 px quel que soit l'étirement.
export function Sparkline({ points, previous = null, title, gradientId }) {
  const paths = sparklinePaths(points, previous);
  if (!paths) return null;
  const gid = gradientId || "tcc-spark-gradient";
  return (
    <svg className="tcc-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" role="img">
      <title>{title}</title>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${gid})`} stroke="none" />
      {paths.ghost && <path className="tcc-spark__ghost" d={paths.ghost} fill="none" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
      <path d={paths.line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {paths.last && <path className="tcc-spark__dot" d={`M${paths.last.x},${paths.last.y} h0.01`} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
