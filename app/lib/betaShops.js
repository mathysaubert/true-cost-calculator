// ── Allowlist bêta — PUR (aucune lecture de process.env, aucune I/O) ─────────────────────────
// BETA_SHOPS (env, lue par l'APPELANT) : domaines .myshopify.com COMPLETS séparés par des
// virgules. Absente ou vide = aucune boutique bêta (défaut sûr en prod). Égalité STRICTE sur le
// domaine complet après normalisation (trim + minuscules) : JAMAIS de includes/endsWith/regex de
// suffixe — « shop.myshopify.com » ne doit matcher ni « evilshop.myshopify.com » ni l'inverse.
// Une entrée malformée (pas un domaine de boutique) est inerte par construction : l'égalité
// stricte ne peut pas la faire correspondre à un session.shop réel.

// Durée d'essai des boutiques bêta sur le plan Expert — SEULE source de la valeur 45.
// La valeur nominale (7 j) reste dans la config billing de shopify.server.js, intacte.
export const BETA_TRIAL_DAYS = 45;

export function isBetaShop(shopDomain, rawBetaShops) {
  if (typeof shopDomain !== "string" || typeof rawBetaShops !== "string") return false;
  const shop = shopDomain.trim().toLowerCase();
  if (!shop) return false;
  return rawBetaShops
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => entry === shop);
}

// Override à ÉTALER dans l'objet passé à billing.request (handler subscribe_expert UNIQUEMENT) :
// shop bêta → { trialDays: BETA_TRIAL_DAYS } fusionné PAR-DESSUS la config du plan par la lib ;
// sinon → {} : l'objet d'appel est identique au comportement actuel au caractère près, la lib
// sert le trialDays: 7 de la config (jamais de trialDays réintroduit en dur ici — cf. bug 9a76bb8).
export function betaTrialOverride(shopDomain, rawBetaShops) {
  return isBetaShop(shopDomain, rawBetaShops) ? { trialDays: BETA_TRIAL_DAYS } : {};
}
