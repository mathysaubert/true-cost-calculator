// ── Verdict ROAS / plateformes — SOURCE UNIQUE ──────────────────────────────
// Code PUR (aucun import React / Shopify) pour être :
//   1. importé par app/routes/app._index.jsx (couleur, conseil, phrase, tableau)
//   2. importé tel quel par les tests Node (tests/lot4_display_guardrails.mjs)
// Toute décision « est-ce atteignable ? » vit ICI — la couche affichage ne fait
// que mapper le verdict vers des pixels (couleurs, texte). Jamais de seuil dupliqué.

// ── Break-even ROAS : hypothèse de tracking ─────────────────────────────────
// Le break-even ROAS = numérateur TTC (valeur de conversion remontée par le pixel
// Meta/Shopify en B2C FR — prix affichés TTC = conversion TTC) / marge HT. C'est la
// base correcte pour l'écrasante majorité des marchands FR. Si le tracking d'un
// marchand remonte du HT, le numérateur devrait alors être HT.

// Fourchettes de ROAS moyen marché, par plateforme. SOURCE UNIQUE des seuils :
// le tableau de viabilité, le conseil CPA, la couleur CPA et la phrase ROAS en
// dérivent tous. Modifier un seuil ICI les met tous à jour de façon cohérente.
export const AD_PLATFORM_RANGES = [
  { name: "Meta Ads",        min: 2.5, max: 3.5 },
  { name: "TikTok Ads",      min: 1.8, max: 2.5 },
  { name: "Google Shopping", min: 3.0, max: 5.0 },
];

// Seuil au-delà duquel aucune plateforme ne tient durablement → bascule organique.
export const ROAS_INVIABLE_THRESHOLD = 10;
export const roasInviable = (roas) => roas > ROAS_INVIABLE_THRESHOLD;

// Statut d'UNE plateforme vis-à-vis du break-even ROAS.
//   roas < min → le seuil est sous le ROAS moyen → la plateforme couvre → "Viable"
//   roas ≤ max → le seuil est dans la fourchette → "Limite"
//   roas > max → la plateforme n'atteint pas le seuil → "Difficile"
export function platformLabel(roas, min, max) {
  if (roas < min) return "Viable";
  if (roas <= max) return "Limite";
  return "Difficile";
}

// Verdict agrégé sur les trois plateformes — la seule règle d'atteignabilité.
//   "facile"    : au moins une plateforme Viable.
//   "tendu"     : zéro Viable mais au moins une Limite.
//   "difficile" : les trois Difficile, ou ROAS irréaliste (> seuil).
// Couleur CPA, phrase ROAS et gate organique du conseil en dérivent tous.
export function roasReachability(roas) {
  if (roasInviable(roas)) return "difficile";
  const labels = AD_PLATFORM_RANGES.map((p) => platformLabel(roas, p.min, p.max));
  if (labels.every((l) => l === "Difficile")) return "difficile";
  if (labels.some((l) => l === "Viable")) return "facile";
  return "tendu";
}

// Couleur de la pastille CPA — signifie l'ATTEIGNABILITÉ (cohérente avec le conseil
// et le tableau), pas la marge € disponible (toujours affichée en chiffre à côté).
//   vert   ⟺ ≥ 1 plateforme Viable      (= conseil nomme ≥ 1 plateforme)
//   orange ⟺ 0 Viable mais ≥ 1 Limite
//   rouge  ⟺ 3 × Difficile ou ROAS irréaliste
export function computeCpaColor(roas) {
  const r = roasReachability(roas);
  if (r === "difficile") return "#D72C0D";
  if (r === "facile")    return "#008060";
  return "#B98900";
}

// Conseil CPA — dérivé du MÊME verdict que le tableau de viabilité.
// Si aucune plateforme n'est Viable (ou ROAS irréaliste) → organique, zéro nom.
// Sinon → ne cite QUE les plateformes Viable/Limite. Jamais une « Difficile ».
export function computeCpaAdvice(roas) {
  const viables  = AD_PLATFORM_RANGES.filter((p) => platformLabel(roas, p.min, p.max) === "Viable");
  const citables = AD_PLATFORM_RANGES.filter((p) => platformLabel(roas, p.min, p.max) !== "Difficile");
  return (roasInviable(roas) || viables.length === 0)
    ? "Aucune plateforme publicitaire n'est viable à ce ROAS — privilégiez l'acquisition organique (UGC, SEO, réseaux sociaux) plutôt que la publicité payante."
    : `CPA exploitable sur ${citables.map((p) => p.name).join(", ")} — concentrez-y votre budget et optimisez vos créatives.`;
}
