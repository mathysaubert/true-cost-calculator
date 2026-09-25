// ── Facturation (F4-D1b, X4) — code DÉPLACÉ depuis l'écran classique, logique inchangée ─────────
// Copie littérale de `isDevStore` et des deux appels `billing.request` de app._index.jsx (lignes
// 853-897 au 2026-09-25). L'écran classique garde sa copie jusqu'à F4-D2 (fichier protégé, 0 diff) ;
// le lot 32 vérifie que les deux copies restent identiques (plans, isTest, returnUrl, essai bêta).
import { PLAN_PRO, PLAN_EXPERT } from "../shopify.server";
import { betaTrialOverride } from "./betaShops.js";
import { resolveEntitlement } from "./plan.server.js";

export const ALL_SUBS_QUERY = `
  query AllSubscriptions {
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
      // Boutique bêta (BETA_SHOPS) → essai 45 j fusionné par-dessus la config ; sinon {} → config (7 j).
      ...betaTrialOverride(session.shop, process.env.BETA_SHOPS),
    });
    return null;
  }
  return { ok: false, error: "unknown_plan" };
}
