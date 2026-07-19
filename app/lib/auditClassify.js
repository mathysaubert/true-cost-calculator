// ── Classification de l'audit catalogue — UNE seule définition de « rentable » ───────────────
// Avant : l'audit classait EN DUR (winners ≥ 15 %, à risque 0–15 %, pertes < 0 %) alors que le
// marchand configure DÉJÀ son seuil de rentabilité (shop_plans.profitability_threshold_pct), le
// MÊME qui pilote les alertes email B7 (api.cron.profitability.jsx). Résultat : un produit à 20 %
// était « Top Performer » dans l'audit tout en étant signalé « sous le seuil » par l'email — l'app
// se contredisait. Ce module est la source UNIQUE de la classification et de ses libellés : l'audit
// et l'alerting partagent désormais la même frontière, ils ne peuvent plus diverger.
//
// Seuil t (en %, ≥ 0), sur la marge nette netPct :
//   • loser  : netPct < 0        → perte réelle
//   • risky  : 0 ≤ netPct < t     → rentable mais SOUS l'objectif du marchand
//   • winner : netPct ≥ t         → au-dessus (ou pile) sur l'objectif
//
// Cas t = 0 (défaut « n'alerter qu'en perte réelle ») : la bande « à risque » (0 ≤ x < 0) est
// STRUCTURELLEMENT vide et tout produit rentable est « winner ». C'est VOULU et cohérent avec
// l'alerting à seuil 0 — aucun repli qui réintroduirait une frontière fantôme. Les libellés
// (auditLabels) rendent cette bande vide lisible plutôt qu'absurde.

// Normalise le seuil : négatif / non fini → 0 (perte stricte).
const normThreshold = (t) => (Number.isFinite(t) && t > 0 ? t : 0);

// Format FR d'un seuil pour les libellés (25 → "25", 25.5 → "25,5").
const fmtPct = (n) => {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};

// Catégorie d'UN produit — "loser" | "risky" | "winner".
export function auditCategory(netPct, thresholdPct = 0) {
  const t = normThreshold(thresholdPct);
  if (!(netPct >= 0)) return "loser";   // NaN/undefined ⇒ traité comme perte (jamais « winner » à tort)
  if (netPct < t) return "risky";        // t = 0 ⇒ jamais atteint (0 ≤ x < 0 impossible) ⇒ winner
  return "winner";
}

// Partitionne une liste de produits { netPct } selon le seuil. Ordre d'entrée préservé.
export function classifyAudit(products = [], thresholdPct = 0) {
  const losers = [], risky = [], winners = [];
  for (const p of products) {
    const c = auditCategory(p?.netPct, thresholdPct);
    (c === "loser" ? losers : c === "risky" ? risky : winners).push(p);
  }
  return { losers, risky, winners };
}

// Libellés qui DÉCRIVENT les bornes réelles — jamais une valeur en dur qui mentirait sur le calcul.
export function auditLabels(thresholdPct = 0) {
  const t = normThreshold(thresholdPct);
  return {
    threshold: t,
    winners: `marge ≥ ${fmtPct(t)} %`,
    // t = 0 : bande vide ⇒ on l'annonce au lieu d'afficher un « marge 0–0 % » absurde.
    risky: t > 0 ? `marge 0–${fmtPct(t)} %` : "seuil à 0 % — bande inactive",
    losers: "marge < 0 %",
  };
}
