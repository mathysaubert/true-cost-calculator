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

// Statut de CHAQUE plateforme à un ROAS donné — le tableau `statuses` unique dont
// dérivent couleur CPA, conseil CPA et phrase ROAS. Calculé une seule fois, zéro
// recalcul dupliqué : un seul endroit décide « quelle plateforme est dans quel état ».
function platformStatuses(roas) {
  return AD_PLATFORM_RANGES.map((p) => ({ name: p.name, label: platformLabel(roas, p.min, p.max) }));
}

// Verdict agrégé sur les trois plateformes — la seule règle d'atteignabilité.
//   "facile"    : au moins une plateforme Viable.
//   "tendu"     : zéro Viable mais au moins une Limite.
//   "difficile" : les trois Difficile, ou ROAS irréaliste (> seuil).
// Couleur CPA, phrase ROAS et gate organique du conseil en dérivent tous.
export function roasReachability(roas) {
  if (roasInviable(roas)) return "difficile";
  const labels = platformStatuses(roas).map((s) => s.label);
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
  const statuses = platformStatuses(roas);
  const anyViable = statuses.some((s) => s.label === "Viable");
  const citables  = statuses.filter((s) => s.label !== "Difficile");
  return (roasInviable(roas) || !anyViable)
    ? "Aucune plateforme publicitaire n'est viable à ce ROAS — privilégiez l'acquisition organique (UGC, SEO, réseaux sociaux) plutôt que la publicité payante."
    : `CPA exploitable sur ${citables.map((s) => s.name).join(", ")} — concentrez-y votre budget et optimisez vos créatives.`;
}

// Phrase d'ambiance sous le chiffre ROAS — branchée sur le verdict agrégé, JAMAIS
// sur un seuil arbitraire ni un nom de plateforme (l'ancienne nommait « Meta » même
// quand Meta était Difficile → contradiction d'écran, même classe que BUG 2).
export function computeRoasPhrase(roas) {
  switch (roasReachability(roas)) {
    case "facile": return "Ce seuil est atteignable — la plupart des plateformes publicitaires peuvent le tenir.";
    case "tendu":  return "Ce seuil est tendu — peu de plateformes le soutiennent, vos campagnes devront être très optimisées.";
    default:       return "Ce seuil est difficile à maintenir — votre marge publicitaire est très serrée.";
  }
}
