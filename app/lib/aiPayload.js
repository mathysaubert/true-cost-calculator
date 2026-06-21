// ── Construction du payload IA — fragments purs et testables ────────────────
// Code PUR : importé par la route (action ai_recommend) ET par les tests Node.
// Règle fondatrice : l'IA NARRE les chiffres du moteur, elle n'en dérive aucun.
// Tout nombre cité dans le prompt vient d'un objet `m` produit par computeMargin —
// jamais d'une soustraction/division inline (c'était BUG 1 : marge brute re-dérivée
// en prixVente − coutRendu, base TTC, ≠ tuile affichée en base HT).

import { formatEur, formatPct } from "./engine.js";

// Ligne « marges » du prompt. La marge brute € est m.margeBrute (moteur, base HT),
// PAS une re-dérivation. Iso au rendu de la tuile « Marge brute » au centime.
export function buildMargeLine(m) {
  return `Marge apparente : ${formatPct(m.margeApparente)} % | Marge brute : ${formatPct(m.margeBrutePercent)} % (${formatEur(m.margeBrute)}) | Marge nette : ${formatPct(m.margeNettePercent)} % (${formatEur(m.margeNette)}/vente)`;
}
