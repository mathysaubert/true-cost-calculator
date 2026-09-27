// ── Facturation (F4-D1b, X4 ; D2-1) — lecture de l'offre et abonnements par l'API de facturation ──
// D2-1 : `requestSubscription` (API de facturation) ne sert que tant qu'App Pricing n'est pas activée
// sur l'app (interrupteur SHOPIFY_APP_PRICING, plans.js). Une fois activée, Shopify interdit de créer
// une facturation par l'API : l'écran Offre renvoie alors vers la page d'offres de Shopify.
// W3 (b) : plus d'essai bêta fusionné ici (BETA_SHOPS retiré) ; la bêta passe par une prolongation
// d'essai sur l'offre Expert publique.
import { PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
import { resolveEntitlement } from "./plan.server.js";

// shop { id } : identifiant de la boutique pour le secours par l'API Partner (W1, plan.server.js).
export const ALL_SUBS_QUERY = `
  query AllSubscriptions {
    shop { id }
    currentAppInstallation {
      allSubscriptions(first: 25, reverse: true) { edges { node { id name status } } }
    }
  }
`;

// Détecte une boutique de développement Partenaire (dev store) → abonnement de TEST (non facturé).
// SÛR par construction : (1) un dev store NE PEUT PAS traiter de vrais paiements clients (Shopify le
// bloque) → un abonnement de test ne perd AUCUN revenu réel ; (2) un vrai marchand sur plan payant
// rapporte partnerDevelopment=false, non falsifiable. DÉFAUT SÛR : toute incertitude (erreur GraphQL,
// champ absent, timeout) retombe sur FALSE → facturation RÉELLE. Le doute ne donne JAMAIS un test.
export async function isDevStore(admin) {
  try {
    const r = await admin.graphql(`{ shop { plan { partnerDevelopment } } }`);
    const j = await r.json();
    return j.data?.shop?.plan?.partnerDevelopment === true;
  } catch (e) {
    console.error("[Billing] dev-store detect:", e?.message);
    return false; // au moindre doute → facturation réelle
  }
}

// Même chemin que le loader classique : source de vérité UNIQUE du droit au plan (fail-safe D1,
// borne FROZEN D2, indéterminé Q1). Ne lève pas : l'écran Offre affiche l'état indéterminé.
export async function loadEntitlement({ admin, shop }) {
  let subJson = null;
  try { subJson = await (await admin.graphql(ALL_SUBS_QUERY)).json(); }
  catch (e) { console.error("[Billing] subscription query failed:", e?.message); }
  return resolveEntitlement({ shop, json: subJson, refetch: async () => (await admin.graphql(ALL_SUBS_QUERY)).json() });
}

// Les deux abonnements, arguments identiques à l'écran classique. `billing.request` lève la
// redirection vers la page d'approbation Shopify : l'appelant ne reçoit rien en retour.
export async function requestSubscription({ billing, admin, session, plan }) {
  // returnUrl must stay inside the Shopify Admin context so authenticate.admin()
  // can resolve the session on return. Using the Vercel URL directly causes a
  // redirect to /auth/login (manual shop input) because there is no App Bridge token.
  if (plan === "pro") {
    await billing.request({
      plan: PLAN_PRO,
      isTest: await isDevStore(admin), // dev store → test ; toute incertitude → false (facturation réelle)
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
    });
    return null;
  }
  if (plan === "expert") {
    await billing.request({
      plan: PLAN_EXPERT,
      isTest: await isDevStore(admin), // dev store → test ; toute incertitude → false (facturation réelle)
      returnUrl: `https://${session.shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?subscribed=true`,
    });
    return null;
  }
  return { ok: false, error: "unknown_plan" };
}
