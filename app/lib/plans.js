// ── Offres (F4-D1b ; D2-1 W7) — PUR : ce que l'écran Offre affiche. Aucun tarif décidé ici : les
// montants et l'essai reflètent la configuration de facturation (shopify.server.js, et les plans créés
// dans le Partner Dashboard une fois App Pricing activée) ; le lot 32 vérifie l'égalité. Volumes : Y2.
import { PLAN_ORDER_CAPS } from "./plan.js";

export const PLAN_OFFERS = [
  { id: "free",   price: 0,  trialDays: 0,  orders: PLAN_ORDER_CAPS.free,   features: 4, badge: null },
  { id: "pro",    price: 29, trialDays: 14, orders: PLAN_ORDER_CAPS.pro,    features: 5, badge: "recommended" },
  { id: "expert", price: 69, trialDays: 14, orders: PLAN_ORDER_CAPS.expert, features: 2, badge: null },
];
export const PLAN_CURRENCY = "USD";
// Contact public de l'app (déjà publié sur la page de confidentialité) : demandes d'offre sur mesure (Z5).
export const CONTACT_EMAIL = "mathys.aubert@icloud.com";
export const customPlanMailto = (shopDomain) =>
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Offre sur mesure - ${shopDomain ?? ""}`.trim())}`;

// ── D2-1 : Shopify App Pricing ─────────────────────────────────────────────────────────────────
// Interrupteur SHOPIFY_APP_PRICING="1", posé dans Vercel au moment de l'activation d'App Pricing sur
// l'app (GO séparé). Éteint : abonnements par l'API de facturation (comportement d'avant). Allumé :
// l'app ne crée plus aucune facturation, tout changement d'offre passe par la page d'offres de Shopify.
export const isAppPricing = (raw) => String(raw ?? "").trim() === "1";

// Page d'offres de Shopify : https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans
// store_handle = domaine sans « .myshopify.com » ; app_handle = identifiant de l'app (SHOPIFY_APP_HANDLE).
export const DEFAULT_APP_HANDLE = "true-cost-calculator";
export function pricingPageUrl(shopDomain, appHandle = DEFAULT_APP_HANDLE) {
  const store = String(shopDomain ?? "").trim().toLowerCase().replace(/\.myshopify\.com$/, "");
  const app = String(appHandle || DEFAULT_APP_HANDLE).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(store) || !/^[a-z0-9][a-z0-9-]*$/.test(app)) return null;
  return `https://admin.shopify.com/store/${store}/charges/${app}/pricing_plans`;
}

// ent : { isPro, isExpert, source } (resolveEntitlement) ; appPricing : interrupteur allumé ;
// changeUrl : page d'offres de Shopify (pricingPageUrl). App Pricing allumée → aucun bouton d'abonnement
// par carte, un seul bouton « Changer d'offre » (W4 a) ; éteinte → montées par l'API de facturation.
// suggest : offre adaptée au volume du mois écoulé (overageOf) → carte mise en avant (Z3).
export function planView({ ent = null, appPricing = false, changeUrl = null, suggest = null } = {}) {
  const indeterminate = !ent || ent.source === "indeterminate";
  const current = indeterminate ? null : ent.isExpert ? "expert" : ent.isPro ? "pro" : "free";
  const rank = { free: 0, pro: 1, expert: 2 };
  const offers = PLAN_OFFERS.map((o) => ({
    ...o,
    current: o.id === current,
    suggested: o.id === suggest && o.id !== current,
    // On ne propose que les montées (jamais de rétrogradation depuis l'app, comme l'écran classique).
    canSubscribe: !appPricing && !indeterminate && o.id !== "free" && rank[o.id] > rank[current ?? "free"],
  }));
  return { current, indeterminate, source: ent?.source ?? null, offers, top: current === "expert", changeUrl: appPricing ? changeUrl : null };
}
