/* global globalThis */
// ── Stub shopify.server du rendu des routes (scripts/render_routes.mjs) ──────────────────────────
// Session et Admin API simulés : aucune requête réseau. L'état vient de globalThis.__RR_STATE
// ({ shop, plan: "free"|"pro"|"expert", products: [{ id, title, price, cost, variantId }] }).
export const PLAN_PRO = "True Cost Calculator Pro";
export const PLAN_EXPERT = "True Cost Calculator Expert";

const st = () => globalThis.__RR_STATE ?? { shop: "render-check.myshopify.com", plan: "free", products: [] };

function answer(query) {
  const q = String(query);
  const s = st();
  const data = {};
  if (/currentAppInstallation/.test(q)) {
    const name = s.plan === "expert" ? PLAN_EXPERT : s.plan === "pro" ? PLAN_PRO : null;
    const node = name ? { id: "gid://shopify/AppSubscription/1", name, status: "ACTIVE", test: true, trialDays: 0, createdAt: "2026-09-01T00:00:00Z", currentPeriodEnd: "2026-10-01T00:00:00Z" } : null;
    data.currentAppInstallation = { allSubscriptions: { edges: node ? [{ node }] : [] }, activeSubscriptions: node ? [node] : [] };
  }
  if (/\bshop\s*\{/.test(q)) data.shop = { name: "Render Check", email: "owner@example.com", contactEmail: "owner@example.com", currencyCode: "EUR", ianaTimezone: "Europe/Paris", taxesIncluded: true, myshopifyDomain: s.shop, plan: { partnerDevelopment: true, displayName: "Developer Preview", shopifyPlus: false }, billingAddress: { countryCodeV2: "FR" } };
  if (/nodes\s*\(\s*ids/.test(q)) data.nodes = (s.products ?? []).map((p) => ({ id: p.id, title: p.title }));
  if (/products\s*\(/.test(q)) {
    data.products = {
      edges: (s.products ?? []).map((p) => ({ node: { id: p.id, title: p.title, handle: p.title.toLowerCase(), productType: "T-shirt", status: "ACTIVE", isGiftCard: false, category: { name: "Apparel" }, featuredImage: null,
        variants: { edges: [{ node: { id: p.variantId, title: "Default Title", sku: null, price: String(p.price), displayName: p.title, inventoryItem: { id: `${p.variantId}-ii`, unitCost: p.cost == null ? null : { amount: String(p.cost), currencyCode: "EUR" }, countryCodeOfOrigin: null } } }], pageInfo: { hasNextPage: false } } } })),
      pageInfo: { hasNextPage: false, endCursor: null },
    };
  }
  return { data };
}

export const fakeAdmin = {
  graphql: async (query) => { const body = answer(query); return { ok: true, status: 200, headers: new Headers(), json: async () => body }; },
  rest: { get: async () => ({ body: {} }) },
};

const session = () => ({ id: `offline_${st().shop}`, shop: st().shop, scope: "read_orders,read_all_orders,read_products,read_inventory,read_customers,read_returns,read_fulfillments", accessToken: "render-check", isOnline: false });

export const authenticate = {
  admin: async () => ({
    session: session(), admin: fakeAdmin,
    billing: {
      check: async () => ({ hasActivePayment: st().plan !== "free", appSubscriptions: [] }),
      require: async () => ({ hasActivePayment: true, appSubscriptions: [] }),
      request: async () => { throw new Response(null, { status: 302, headers: { Location: "/billing" } }); },
      cancel: async () => ({}),
    },
    redirect: (url) => new Response(null, { status: 302, headers: { Location: url } }),
    cors: (r) => r,
    sessionToken: {},
  }),
  webhook: async () => ({ shop: st().shop, topic: "TEST", payload: {}, session: session(), admin: fakeAdmin }),
  public: { appProxy: async () => ({}) },
};
export const unauthenticated = { admin: async () => ({ admin: fakeAdmin, session: session() }) };
export const login = async () => ({});
export const addDocumentResponseHeaders = () => {};
export const registerWebhooks = async () => {};
export const sessionStorage = {};
export const apiVersion = "2026-01";
export default { authenticate, unauthenticated, login, addDocumentResponseHeaders, registerWebhooks, sessionStorage };
