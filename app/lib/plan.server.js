// ── Résolution du droit au plan côté serveur — UNE fonction pour le loader ET l'action ──
// La décision PURE vit dans plan.js ; ici on ajoute l'I/O qu'elle ne peut pas porter :
//   • D1 fail-safe : si l'appel GraphQL a échoué (enveloppe absente/incomplète), NE PAS dégrader
//     le marchand — retomber sur le dernier plan connu (shop_plans) et NE RIEN réécrire.
//   • D2 borne FROZEN : lire dunning.frozen_since pour dater l'épisode frozen.
//   • persistance : n'écrire shop_plans que sur un SUCCÈS LIVE avéré (sinon on empoisonne le cache).
// Loader et action passent par ici → plus de logique dupliquée (c'est la duplication qui avait
// laissé le bug survivre).
import { supabase } from "../supabase.server";
import { PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
import {
  planEntitlement,
  fallbackEntitlement,
  retryForLiveEnvelope,
  subscriptionNodesFromResponse,
} from "./plan.js";

// Alias de noms par palier (cf. D3, plan.js). Lors d'une refonte tarifaire qui RENOMME un plan :
// AJOUTER ici le nouveau nom SANS retirer l'ancien → les subs déjà vendus (name figé) restent gatés.
const PRO_NAMES = [PLAN_PRO];
const EXPERT_NAMES = [PLAN_EXPERT];

const planLabel = (ent) => (ent.isExpert ? "expert" : ent.isPro ? "pro" : "free");
const hasLiveEnvelope = (json) =>
  Array.isArray(json?.data?.currentAppInstallation?.allSubscriptions?.edges);

// Bornes du retry Q1 (loader/action). Shopify LENT (pas mort) ne doit jamais bloquer le rendu :
//   • ATTEMPT_TIMEOUT_MS : coupe UNE tentative de refetch qui traîne.
//   • RETRY_BUDGET_MS    : plafond de temps TOTAL du retry — au-delà → 'indeterminate' immédiat.
// Sans ces bornes, 3 tentatives sur un Shopify lent pouvaient épuiser le budget de la fonction
// serverless et tuer le rendu (page blanche / 500), précisément pour les nouveaux installs.
const ATTEMPT_TIMEOUT_MS = 700;
const RETRY_BUDGET_MS = 1500;
const withTimeout = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, reject) => setTimeout(() => reject(new Error("refetch timeout")), ms)),
  ]);

// json    : réponse GraphQL parsée d'AllSubscriptions, ou null si l'appel a échoué.
// refetch : () => Promise<json> — re-tente l'appel live (closure fournie par le loader/l'action).
//           Optionnel : sans lui, aucun retry possible → un échec sans cache = indéterminé direct.
// Retour  : { isPro, isExpert, source: 'live'|'cache'|'indeterminate' }.
//   • 'live'          : signal Shopify frais (direct ou après retry) → décision autoritative.
//   • 'cache'         : appel échoué MAIS dernier plan CONNU (D1) → on ne dégrade pas un payeur.
//   • 'indeterminate' : appel échoué ET aucun plan connu (Q1) → l'appelant doit RETENTER / refuser
//                       de rendre free, JAMAIS afficher un free dégradé silencieux.
export async function resolveEntitlement({ shop, json, refetch = null, retries = 2, retryDelayMs = 200, retryBudgetMs = RETRY_BUDGET_MS }) {
  let envelope = json;

  // ── Pas de signal live : cache d'abord (D1), retry ensuite, indéterminé en dernier (Q1) ──
  if (!hasLiveEnvelope(envelope)) {
    // D1 — dernier plan CONNU (shop_plans) : on ne dégrade jamais un payeur déjà résolu. Aucune
    // écriture ici (pas d'empoisonnement du cache).
    let lastPlan = null;
    try {
      const { data } = await supabase
        .from("shop_plans")
        .select("plan")
        .eq("shop_domain", shop)
        .maybeSingle();
      lastPlan = data?.plan ?? null;
    } catch (e) {
      console.error("[Billing] fallback shop_plans read failed:", e?.message);
    }
    if (lastPlan != null) return fallbackEntitlement(lastPlan); // → 'cache'

    // Q1 — ni signal live, ni cache = INDÉTERMINÉ. On RETENTE l'appel live avant de rien rendre,
    // mais BORNÉ en temps (surtout pour un nouvel install pendant un incident Shopify) : chaque
    // tentative est coupée à ATTEMPT_TIMEOUT_MS, et le retry entier est plafonné à retryBudgetMs
    // (au-delà → 'indeterminate' immédiat). Sinon un Shopify lent bloquait le loader jusqu'au cap
    // de la fonction serverless (page blanche / 500) au lieu de rendre l'écran transitoire.
    const boundedRefetch = refetch ? () => withTimeout(refetch(), ATTEMPT_TIMEOUT_MS) : null;
    envelope = await retryForLiveEnvelope({
      envelope,
      refetch: boundedRefetch,
      hasLive: hasLiveEnvelope,
      retries,
      delayMs: retryDelayMs,
      budgetMs: retryBudgetMs,
    });
    // Toujours aucun signal exploitable → indéterminé ASSUMÉ : surtout PAS de free dégradé.
    if (!hasLiveEnvelope(envelope)) return fallbackEntitlement(null); // → 'indeterminate'
    // sinon : le retry a réussi → on poursuit sur le chemin succès live ci-dessous.
  }

  // D2 — succès live : borne FROZEN via dunning.frozen_since.
  let frozenSince = null;
  try {
    const { data } = await supabase
      .from("subscription_dunning_state")
      .select("frozen_since")
      .eq("shop_domain", shop)
      .maybeSingle();
    frozenSince = data?.frozen_since ?? null;
  } catch (e) {
    console.error("[Billing] frozen_since read failed:", e?.message);
  }

  const nodes = subscriptionNodesFromResponse(envelope);
  const ent = planEntitlement(nodes, {
    proNames: PRO_NAMES,
    expertNames: EXPERT_NAMES,
    frozenSince,
    now: Date.now(),
  });

  // Persistance UNIQUEMENT sur succès live (cache de dernier plan connu pour le repli D1).
  supabase
    .from("shop_plans")
    .upsert(
      { shop_domain: shop, plan: planLabel(ent), updated_at: new Date().toISOString() },
      { onConflict: "shop_domain" }
    )
    .then(() => {})
    .catch((e) => console.error("[Plans] upsert failed:", e?.message));

  return { ...ent, source: "live" };
}
