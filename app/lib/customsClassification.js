// ── Fiabilité perçue des taux de douane — statut de CLASSIFICATION (décisions PURES) ──────────
// Le taux TARIC dépend de la CATÉGORIE produit. Tant qu'elle n'est pas VALIDÉE par le marchand, elle
// est une ESTIMATION → tout montant de douane qui en découle porte un indicateur « à confirmer ».
// Statut ORTHOGONAL à la provenance des coûts (`variant_costs.source`) : un coût confirmed peut porter
// une classification estimée (cas nominal du risque). Un flag séparé `customs_confirmed` le matérialise.
//
// engine.js n'est JAMAIS modifié : on importe CUSTOMS_RATES en LECTURE SEULE (source unique des taux).
// Aucun chapitre TARIC inventé — l'indicateur s'adosse à la base réglementaire déjà affichée.
import { CUSTOMS_RATES } from "./engine.js";

// Défaut 'Autre' / catégorie inconnue — même repli que l'UI (CUSTOMS_RATES[cat] ?? 0.03).
const DEFAULT_RATE = 0.03;

// Taux douanier d'une catégorie (lecture pure de la table réglementaire du moteur).
export function customsRateForCategory(categorie) {
  const r = CUSTOMS_RATES[categorie];
  return typeof r === "number" ? r : DEFAULT_RATE;
}

// Statut depuis un flag booléen (variant_costs.customs_confirmed OU le flag figé d'une ligne de marge).
// true ⇒ 'confirmed' ; TOUT le reste (false, null, undefined = miss de jointure / legacy) ⇒ 'estimated'.
// JAMAIS de défaut optimiste : l'incertitude penche vers « estimée ».
export function classificationStatus(customsConfirmed) {
  return customsConfirmed === true ? "confirmed" : "estimated";
}

// Une CORRECTION de catégorie change-t-elle le TAUX ? Compare les taux, pas les libellés :
// Jouets (0 %) → Livres (0 %) = pas de changement de taux ⇒ aucun recalcul proposé à tort.
export function customsRateChanged(oldCategorie, newCategorie) {
  return customsRateForCategory(oldCategorie) !== customsRateForCategory(newCategorie);
}

// Indicateur d'affichage. Classification CONFIRMÉE ⇒ null (AUCUN changement d'affichage, par contrat).
// ESTIMÉE ⇒ libellé court adossé à la nomenclature TARIC déjà citée (jamais de chapitre inventé).
export function customsIndicator(status) {
  if (status !== "estimated") return null;
  return { short: "Taux estimé", label: "Taux estimé — à confirmer", ref: "selon la nomenclature TARIC" };
}

// ── Invalidation à l'écriture (chemins costs_save / costs_import_csv) ──────────────────────────
// Si la catégorie CHANGE, le flag retombe à false (la nouvelle valeur n'a pas été validée) ; si elle
// est IDENTIQUE, on PRÉSERVE le flag courant (réécrire la même valeur n'invalide pas). Cœur de la
// garde « le flag ne pourrit pas » : sans ça, un import CSV réécrivant une catégorie laisserait un
// « confirmée » sur une valeur que personne n'a vue. Comparaison stricte, aucune coercition.
export function resolveCustomsConfirmedOnWrite(oldCategorie, newCategorie, currentFlag = false) {
  // Catégorie ABSENTE du payload (null/undefined) : PostgREST ne l'écrasera pas → valeur inchangée en base
  // → le flag est PRÉSERVÉ (jamais de dé-confirmation silencieuse sur une catégorie qui ne bouge pas).
  if (newCategorie == null) return currentFlag === true;
  if (newCategorie !== oldCategorie) return false;
  return currentFlag === true;
}

// ── Lecture du statut FIGÉ d'une ligne de marge (snapshot d'intrants) ──────────────────────────
// cost_snapshot_json null (ligne 'missing' ou legacy pré-champ) ou champ absent ⇒ 'estimated'.
export function frozenClassificationStatus(costSnapshot) {
  return classificationStatus(costSnapshot?.customs_confirmed);
}

// ── Feedback de confirmation (UI) : rateChanged est COLLANT jusqu'à fermeture explicite ────────
// La guidance recalcul (rateChanged=true) ne doit pas être écrasée par une confirmation suivante.
//   • next absent ⇒ on garde prev.
//   • erreur ⇒ remplace tout (l'erreur prime ; un éventuel rateChanged de prev est perdu, acceptable).
//   • succès ⇒ hérite rateChanged=true d'un succès précédent (collant).
export function mergeCustomsFeedback(prev, next) {
  if (!next) return prev ?? null;
  if (!next.success) return next;
  const stickyRate = next.rateChanged === true || (prev?.success === true && prev?.rateChanged === true);
  return { ...next, rateChanged: stickyRate };
}

// ── Audit catalogue (configuration actuelle) : catégorie EFFECTIVE + statut ────────────────────
// Si la variante SCANNÉE possède une ligne variant_costs customs_confirmed=true, l'audit ADOPTE la
// catégorie confirmée (calcul ET affichage) → jamais deux taux pour le même produit après confirmation.
// Sinon (pas de ligne = trou, ou non confirmée) : catégorie mappée Shopify + indicateur estimé.
// `vc` = ligne variant_costs de la variante scannée (ou null/undefined si aucune). Entrée conservatrice :
// vc absent ⇒ estimé (jamais d'optimisme sur un miss de jointure).
export function resolveAuditCategory(vc, mappedCategory) {
  const confirmed = vc?.customs_confirmed === true;
  return { category: confirmed ? vc.categorie : mappedCategory, estimated: !confirmed };
}
