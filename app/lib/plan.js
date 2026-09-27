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
//
// D2-1 (W2, W5, W6) — Shopify App Pricing : un abonnement porte le NOM du plan créé dans le Partner
// Dashboard (18 caractères au plus, définitif). « Pro » et « Expert » s'ajoutent aux anciens noms de
// l'API de facturation, gardés pour les abonnés existants (facturation manuelle jusqu'à migration).
// Offres sur mesure (Z5) : plans privés nommés « Expert … », reconnus comme Expert par ce préfixe.
// « Free » (abonnement ACTIVE à 0 $) n'est dans aucune liste : il vaut Gratuit, comme tout nom inconnu.
export const LEGACY_PRO_NAME = "True Cost Calculator Pro";
export const LEGACY_EXPERT_NAME = "True Cost Calculator Expert";
export const PRO_NAMES = [LEGACY_PRO_NAME, "Pro"];
export const EXPERT_NAMES = [LEGACY_EXPERT_NAME, "Expert"];
export const EXPERT_PREFIXES = ["Expert "];
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
    expertPrefixes = [],
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
  const prefixes = Array.isArray(expertPrefixes) ? expertPrefixes.filter(Boolean) : [];
  const isExpertName = (n) => typeof n === "string" && (expert.has(n) || prefixes.some((p) => n.startsWith(p)));
  const hasEntitled = (match) =>
    nodes.some((s) => match(s?.name) && ENTITLED_STATUSES.has(s?.status) && entitles(s));

  const isExpert = hasEntitled(isExpertName);
  const isPro = isExpert || hasEntitled((n) => pro.has(n));
  return { isPro, isExpert };
}

// ── API Partner (W1, secours) : plan d'après `activeSubscription.items[].handle` — PUR ──────────
// Identifiants des plans App Pricing : `pro`, `expert`, et `expert-…` pour les offres sur mesure (W6).
// Abonnement absent ou identifiant inconnu (dont `free`) → 'free'.
export function planFromPartnerSubscription(sub) {
  const handles = (Array.isArray(sub?.items) ? sub.items : []).map((i) => String(i?.handle ?? "").toLowerCase());
  if (handles.some((h) => h === "expert" || h.startsWith("expert-"))) return "expert";
  if (handles.includes("pro")) return "pro";
  return "free";
}

// ── D2-2 (Y2) : volume de commandes par mois compris dans chaque offre ──────────────────────────
// Gratuit 50, Pro 500, Expert 3 000 ; au-delà de 3 000 : offre sur mesure sur demande (Z5).
export const PLAN_ORDER_CAPS = { free: 50, pro: 500, expert: 3000 };

// ── D2-2 : palier du mois — PUR ─────────────────────────────────────────────────────────────
// Z2 : compte pour le palier toute commande CRÉÉE dans le mois (fuseau de la boutique, day_local), sauf
// commandes de test et brouillons ; comptée depuis `orders`. Z3 : dépassement au mois M → bandeau, page
// Offre mise en avant et UN e-mail, à partir du 1er du mois M+1 ; jamais de blocage. Y3 : plus aucune
// coupure des alertes au volume (l'ancien plafond 200 / 1 000 / illimité et alertingEnabled sont retirés).
const RANK = { free: 0, pro: 1, expert: 2 };
export const planLabelOf = (ent = {}) => (ent?.isExpert ? "expert" : ent?.isPro ? "pro" : "free");

// "YYYY-MM" → { from: "YYYY-MM-01", to: 1er du mois suivant } (bornes de day_local, fin exclue).
export function monthRange(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  return { from: `${ym}-01`, to: `${next}-01` };
}
export function prevMonthOf(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

// plan : 'free'|'pro'|'expert' ; count : commandes du mois écoulé. suggest : plus petite offre supérieure
// dont le volume couvre le mois, sinon 'custom' (au-delà de 3 000 : offre sur mesure, Z5).
export function overageOf({ plan = "free", count = 0 } = {}) {
  const p = plan in PLAN_ORDER_CAPS ? plan : "free";
  const cap = PLAN_ORDER_CAPS[p];
  const n = Number(count) || 0;
  const over = n > cap;
  const suggest = !over ? null : (["pro", "expert"].find((q) => RANK[q] > RANK[p] && PLAN_ORDER_CAPS[q] >= n) ?? "custom");
  return { plan: p, cap, count: n, over, suggest };
}

// Mois PRÉCÉDENT au format "YYYY-MM" — PUR. Le cron lit usage.orders_count de ce mois pour la
// bascule différée (dépassement en M → coupure en M+1). Date.UTC avec month-1 normalise nativement
// le rollover d'année : janvier 2026 → "2025-12". Le jour d'entrée est indifférent (on force le 1er).
export function previousMonth(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
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
