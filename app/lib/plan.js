// ── Droit au plan payant depuis les abonnements Shopify — PUR (aucun I/O, aucun React) ──
// UNE seule source de vérité pour la décision de plan, appelée par le loader ET l'action (via
// plan.server.js). Avant, la dérivation était DUPLIQUÉE (loader + action) avec le même filtre
// `status === "ACTIVE"` : c'est cette duplication qui a laissé le bug FROZEN survivre.
//
// À lire depuis `allSubscriptions` (PAS `activeSubscriptions`, qui MASQUE les FROZEN), et en
// `reverse: true` (le sub courant, le plus récent, doit rester dans la première page — cf. D4).
//
// Statuts qui ouvrent droit au plan payant :
//   • ACTIVE : abonnement payé, en cours.
//   • FROZEN : paiement échoué, MAIS Shopify laisse une fenêtre de grâce (le sub se réactive au
//     paiement). Shopify NE documente AUCUNE transition auto FROZEN→CANCELLED/EXPIRED : un sub
//     peut rester FROZEN indéfiniment. On BORNE donc la grâce côté app (FROZEN_GRACE_DAYS,
//     mesurée depuis dunning.frozen_since) pour ne pas offrir le payant à vie sans paiement (D2).
// Tout le reste (CANCELLED / EXPIRED / DECLINED / PENDING / inconnu) = pas d'abonnement → free.
//
// RISQUE DOCUMENTÉ — GATING PAR NOM (D3) : cette app définit ses plans PAR NOM dans la config
// billing (shopify.server.js) ; le sub Shopify n'expose pas de handle de plan stable, et son `id`
// change à chaque ré-abonnement. Le NOM est donc la seule clé disponible. Le `name` d'un sub est
// FIGÉ à sa création : une refonte tarifaire qui renomme les plans ne renomme PAS les subs déjà
// vendus. Pour ne pas rendre les abonnés existants invisibles au gating, on matche un ENSEMBLE de
// noms par palier (proNames/expertNames) : lors d'un renommage, AJOUTER le nouveau nom sans retirer
// l'ancien (voir la liste d'alias dans plan.server.js).
const ENTITLED_STATUSES = new Set(["ACTIVE", "FROZEN"]);
export const FROZEN_GRACE_DAYS = 28;
const DAY_MS = 86_400_000;

const toSet = (namesOrName) =>
  new Set(Array.isArray(namesOrName) ? namesOrName : namesOrName != null ? [namesOrName] : []);
const toMs = (t) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));

// ── Extracteur PARTAGÉ de la réponse GraphQL → nœuds d'abonnement (D5) ────────
// Loader, action ET le test lot16 passent par ici : la forme d'enveloppe attendue
// (data.currentAppInstallation.allSubscriptions.edges[].node) est EXÉCUTÉE, pas narrée.
// Si la forme dérive d'un cran, le résultat est [] → billingIsPro devient false → lot16 rougit.
export function subscriptionNodesFromResponse(json) {
  const edges = json?.data?.currentAppInstallation?.allSubscriptions?.edges;
  return Array.isArray(edges) ? edges.map((e) => e?.node).filter(Boolean) : [];
}

// Entrée : nœuds [{ name, status }] (subscriptionNodesFromResponse) + options :
//   proNames / expertNames : string | string[] (alias inclus, cf. D3).
//   frozenSince            : début de l'épisode frozen (dunning.frozen_since) ou null.
//   now                    : instant de référence (Date | ms | ISO), défaut Date.now().
//   frozenGraceDays        : fenêtre de grâce FROZEN, défaut FROZEN_GRACE_DAYS.
// Sortie : { isPro, isExpert } — isExpert ⇒ isPro (l'Expert englobe le Pro).
export function planEntitlement(subscriptionNodes = [], opts = {}) {
  const {
    proNames,
    expertNames,
    frozenSince = null,
    now = Date.now(),
    frozenGraceDays = FROZEN_GRACE_DAYS,
  } = opts;
  const nodes = Array.isArray(subscriptionNodes) ? subscriptionNodes : [];
  const pro = toSet(proNames);
  const expert = toSet(expertNames);

  // FROZEN n'entitle que dans la fenêtre de grâce (D2). frozen_since inconnu → grâce accordée
  // (l'épisode vient de commencer, le cron dunning ne l'a pas encore daté).
  const frozenSinceMs = frozenSince == null ? null : toMs(frozenSince);
  const frozenWithinGrace =
    frozenSinceMs == null || !Number.isFinite(frozenSinceMs)
      ? true
      : toMs(now) - frozenSinceMs <= frozenGraceDays * DAY_MS;

  const entitles = (s) =>
    s?.status === "ACTIVE" || (s?.status === "FROZEN" && frozenWithinGrace);
  const hasEntitled = (nameSet) =>
    nodes.some((s) => nameSet.has(s?.name) && ENTITLED_STATUSES.has(s?.status) && entitles(s));

  const isExpert = hasEntitled(expert);
  const isPro = isExpert || hasEntitled(pro);
  return { isPro, isExpert };
}

// ── Plafond d'alerting au volume de commandes (C4a — fondation, branchement en C4b) ──────────
// PUR. Palier de commandes ingérées/mois par plan : Gratuit 200 / Pro 1000 / Expert illimité.
// isExpert ⇒ isPro (l'Expert englobe le Pro) → on teste isExpert d'abord. Entrée = { isPro, isExpert }
// (la sortie de planEntitlement / resolveEntitlement).
export function planToOrderCap(ent = {}) {
  return ent.isExpert ? Infinity : ent.isPro ? 1000 : 200;
}

// alerting activé ce mois ⇔ le compteur du mois PRÉCÉDENT n'a pas dépassé le palier (bascule
// DIFFÉRÉE : dépassement en M → coupure en M+1, le mois en cours toujours servi). Borne INCLUSIVE
// (== cap → encore activé), cohérente avec la borne de grâce (planEntitlement). PUR.
export function alertingEnabled(prevMonthCount, cap) {
  return prevMonthCount <= cap;
}

// ── Repli PUR sur le dernier plan connu (D1) — 'expert'|'pro'|'free' → { isPro, isExpert } ─
// Utilisé quand l'appel GraphQL échoue : on ne dégrade JAMAIS un payeur sur une panne d'infra.
export function entitlementFromPlan(plan) {
  const isExpert = plan === "expert";
  const isPro = isExpert || plan === "pro";
  return { isPro, isExpert };
}

// ── Repli sur ÉCHEC LIVE (D1/Q1) — distingue 'free CONNU' de 'INDÉTERMINÉ' ───────────────────
// lastPlan vient de shop_plans, écrit UNIQUEMENT sur un succès live (plan.server.js). Donc :
//   • 'expert'/'pro'/'free' = dernier plan CONNU (une résolution live a déjà eu lieu) → on le sert
//     (source 'cache', non dégradant : D1).
//   • null/inconnu = AUCUN plan jamais résolu. Un marchand réellement gratuit et un payeur dont le
//     TOUT PREMIER chargement live a échoué sont ICI indistinguables (même absence de ligne, même
//     absence d'enveloppe live). On NE rend donc PAS free — ce serait dégrader le payeur (Q1) : on
//     marque 'indeterminate' pour que l'appelant RETENTE, plutôt que de rendre un free silencieux.
const KNOWN_PLANS = new Set(["expert", "pro", "free"]);
export function fallbackEntitlement(lastPlan) {
  return KNOWN_PLANS.has(lastPlan)
    ? { ...entitlementFromPlan(lastPlan), source: "cache" }
    : { isPro: false, isExpert: false, source: "indeterminate" };
}

// ── Retry BORNÉ d'un signal live (Q1) — PUR (sleep/now injectables) ──────────────────────────
// Quand l'appel live a échoué ET qu'aucun plan n'est en cache, on retente `refetch` pour distinguer
// un incident TRANSITOIRE d'un vrai indéterminé — SANS bloquer le loader si Shopify est LENT (pas
// mort). Deux bornes CUMULÉES : nombre de tentatives (retries) ET budget de temps TOTAL (budgetMs) ;
// au-delà du budget on abandonne immédiatement (l'appelant rendra 'indeterminate'). refetch DOIT être
// borné PAR tentative par l'appelant (timeout) — ici on ne plafonne que le nombre et le temps global.
// Retourne la 1re enveloppe live obtenue, sinon la dernière valeur non-live.
export async function retryForLiveEnvelope({
  envelope,
  refetch,
  hasLive,
  retries = 2,
  delayMs = 200,
  budgetMs = 1500,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  if (typeof refetch !== "function") return envelope;
  const start = now();
  for (let i = 0; i < retries && !hasLive(envelope); i++) {
    if (now() - start >= budgetMs) break;        // budget total épuisé → abandon immédiat
    await sleep(delayMs);
    if (now() - start >= budgetMs) break;        // budget épuisé pendant l'attente → abandon
    try { envelope = await refetch(); } catch { envelope = null; }
  }
  return envelope;
}
