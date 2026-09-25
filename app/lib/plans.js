// ── Offres (F4-D1b) — PUR : ce que l'écran Offre affiche. Aucun tarif décidé ici : les montants et
// l'essai reflètent la configuration de facturation de shopify.server.js (le lot 32 vérifie l'égalité).
export const PLAN_OFFERS = [
  { id: "free",   price: 0,  trialDays: 0, features: 4, badge: null },
  { id: "pro",    price: 29, trialDays: 7, features: 4, badge: "popular" },
  { id: "expert", price: 69, trialDays: 7, features: 5, badge: "recommended" },
];
export const PLAN_CURRENCY = "USD";
export const BETA_TRIAL_DAYS_FALLBACK = 45;

// ent : { isPro, isExpert, source } (resolveEntitlement) ; isBeta : boutique bêta (essai Expert 45 j).
export function planView({ ent = null, isBeta = false, betaTrialDays = BETA_TRIAL_DAYS_FALLBACK } = {}) {
  const indeterminate = !ent || ent.source === "indeterminate";
  const current = indeterminate ? null : ent.isExpert ? "expert" : ent.isPro ? "pro" : "free";
  const rank = { free: 0, pro: 1, expert: 2 };
  const offers = PLAN_OFFERS.map((o) => ({
    ...o,
    trialDays: o.id === "expert" && isBeta ? betaTrialDays : o.trialDays,
    current: o.id === current,
    // On ne propose que les montées (jamais de rétrogradation depuis l'app, comme l'écran classique).
    canSubscribe: !indeterminate && o.id !== "free" && rank[o.id] > rank[current ?? "free"],
  }));
  return { current, indeterminate, source: ent?.source ?? null, offers, top: current === "expert" };
}
