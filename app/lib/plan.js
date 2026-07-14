// ── Droit au plan payant depuis les abonnements Shopify — PUR (aucun I/O, aucun React) ──
// UNE seule source de vérité, appelée par le loader ET l'action. Avant, la dérivation était
// DUPLIQUÉE à deux endroits (loader + action) avec le même filtre `status === "ACTIVE"` : c'est
// cette duplication qui a laissé le bug FROZEN survivre (corriger un endroit n'aurait pas suffi).
//
// À lire depuis `allSubscriptions` (PAS `activeSubscriptions`, qui MASQUE les FROZEN).
// Statuts qui ouvrent droit au plan payant :
//   • ACTIVE : abonnement payé, en cours.
//   • FROZEN : paiement échoué, MAIS Shopify laisse une FENÊTRE DE GRÂCE avant résiliation —
//     l'accès est MAINTENU pendant ce délai (le dunning relance ; on ne rétrograde pas au 1er échec).
// Tout le reste (CANCELLED / EXPIRED / DECLINED / PENDING / inconnu) = pas d'abonnement → free.
const ENTITLED_STATUSES = new Set(["ACTIVE", "FROZEN"]);

// Entrée : nœuds d'abonnement [{ name, status }] (allSubscriptions.edges[].node) + noms des plans.
// Sortie : { isPro, isExpert } — isExpert ⇒ isPro (l'Expert englobe le Pro).
export function planEntitlement(subscriptionNodes = [], proName, expertName) {
  const nodes = Array.isArray(subscriptionNodes) ? subscriptionNodes : [];
  const hasEntitled = (name) => nodes.some((s) => s?.name === name && ENTITLED_STATUSES.has(s?.status));
  const isExpert = hasEntitled(expertName);
  const isPro = isExpert || hasEntitled(proName);
  return { isPro, isExpert };
}
