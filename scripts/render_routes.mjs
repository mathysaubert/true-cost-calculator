/* global globalThis */
// ── Rendu RÉEL de toutes les routes UI (D0, React 19) ────────────────────────────────────────────
// Pour chaque route : le VRAI loader, le VRAI composant et la VRAIE coquille /app (AppProvider v3,
// I18nProvider, navigation) passent par le static handler de React Router puis renderToString.
// Seules les E/S externes sont simulées (scripts/stubs) : session Shopify, Admin API, Supabase en
// mémoire, Prisma, Sentry. Aucun réseau, aucune base réelle, aucune variable d'environnement lue.
// Deux états : boutique vide (état initial) et boutique chargée (commandes, coûts, décisions).
// Le document racine (root.jsx : Links/Meta/Scripts, mode framework) n'est pas rendu ici ; il est
// inchangé par D0 et couvert par `npm run build`.
// Lancer : node scripts/render_routes.mjs   (RR_FULL=1 pour le HTML complet des échecs)
import { createServer } from "vite";
import path from "node:path";
import React from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider, Outlet } from "react-router";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const STUBS = Object.fromEntries(["shopify.server", "supabase.server", "db.server", "sentry.server"].map((n) => [n, path.join(ROOT, "scripts", "stubs", `${n}.js`)]));
const stubPlugin = {
  name: "tcc-render-stubs", enforce: "pre",
  resolveId(source) {
    if (!source.startsWith(".")) return null;
    const base = source.split("/").pop().replace(/\.(js|jsx|ts)$/, "");
    return STUBS[base] ?? null;
  },
};
process.env.SHOPIFY_API_KEY = "render-check-api-key";

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "error", plugins: [stubPlugin] });
const load = (p) => vite.ssrLoadModule(p);

// ── Données simulées ──────────────────────────────────────────────────────────────────────────────
const SHOP = "render-check.myshopify.com";
const today = new Date();
const dayAgo = (n) => new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const PRODUCTS = [
  { id: "gid://shopify/Product/101", title: "Tee", price: 60, cost: 22, variantId: "gid://shopify/ProductVariant/1011" },
  { id: "gid://shopify/Product/102", title: "Cap", price: 20, cost: 25, variantId: "gid://shopify/ProductVariant/1021" },
  { id: "gid://shopify/Product/103", title: "Mug", price: 15, cost: null, variantId: "gid://shopify/ProductVariant/1031" },
];
const settingsRow = { shop_domain: SHOP, shop_currency: "EUR", shop_timezone: "UTC", shop_country_code: "FR", is_dev_shop: true, include_test_orders: false, vat_regime: "assujetti", shipping_model: "stock", return_window_days: 30, packaging_cost_per_order: 0.5, return_cost_per_return: 3, shipping_cost_rules: { default: 4, confirmed: true, byCountry: {} }, gateway_fee_rules: [{ gateway: "*", pct: 1.5, fixed: 0.25, confirmed: true }], profitability_threshold_pct: 25, target_margin_after_ads_pct: 15, main_product_price: 60, locale_override: null };
function loadedDb() {
  const orders = [], lines = [];
  for (let i = 0; i < 18; i++) {
    const day = dayAgo(1 + i), id = `gid://shopify/Order/${9000 + i}`;
    const p = PRODUCTS[i % 3], qty = 1 + (i % 2);
    const ht = p.price / 1.2, tax = (p.price - ht) * qty;
    orders.push({ shop_domain: SHOP, order_id: id, order_name: `#${1000 + i}`, day_local: day, created_at: `${day}T10:00:00Z`, excluded_reason: null, currency_code: "EUR", total_ttc: p.price * qty + 4.9, ca_ht: ht * qty, subtotal_ttc: p.price * qty, shipping_charged: 4.9, discounts_amount: 0, discount_codes: [], customer_order_index: i % 4 === 0 ? 2 : 1, country_code: "FR", gateway_names: ["shopify_payments"], source_name: "web" });
    lines.push({ shop_domain: SHOP, order_id: id, line_item_id: `gid://shopify/LineItem/${9000 + i}`, product_id: p.id, variant_id: p.variantId, quantity: qty, refunded_qty: 0, effective_qty: qty, unit_price_ht: ht, tax_lines: [{ rate: 0.2, amount: tax }], is_gift_card: false, cm1_components: null, cm1_unit: p.cost == null ? null : ht - p.cost * 1.12, cm2_alloc: null, breakdown_version: 2, cost_source: p.cost == null ? "missing" : i % 3 === 1 ? "estimated" : "confirmed", currency_code: "EUR", day_local: day });
  }
  return {
    shop_settings: [settingsRow], orders, order_margins: lines,
    shop_plans: [{ shop_domain: SHOP, plan: "expert", profitability_threshold_pct: 25 }],
    variant_costs: [{ shop_domain: SHOP, variant_id: PRODUCTS[0].variantId, product_id: PRODUCTS[0].id, source: "confirmed", prix_achat: 22, port_entrant: 40, qty_par_lot: 10, categorie: "Textile", customs_confirmed: true, vat_regime: "assujetti", shipping_model: "stock" }],
    fixed_costs: [{ shop_domain: SHOP, id: "fc1", label: "Abonnement Shopify", amount_monthly: 39, active_from: dayAgo(90), active_to: null }],
    decision_log: [{ shop_domain: SHOP, id: "d1", kind: "simulated", decided_at: `${dayAgo(3)}T09:00:00Z`, scenario: { source: "simulator", values: { price: 5 }, days: 30, horizon: "period", mode: "shop" }, expected_impact_low: 40, expected_impact_high: 60, review_at: `${dayAgo(-27)}T09:00:00Z`, observed_at: null, observed_impact: null, note: null }],
    insight_log: [], usage: [], rate_limits: [], sync_jobs: [{ shop_domain: SHOP, kind: "incremental", status: "completed", finished_at: today.toISOString(), window_end: today.toISOString() }],
  };
}
const STATES = {
  empty: { db: { shop_settings: [{ shop_domain: SHOP, shop_currency: "EUR", shop_timezone: "UTC", is_dev_shop: false }] }, state: { shop: SHOP, plan: "free", products: [] } },
  loaded: { db: loadedDb(), state: { shop: SHOP, plan: "expert", products: PRODUCTS } },
};

// ── Arbre des routes (mêmes ids que le mode framework) ───────────────────────────────────────────
const APP_CHILDREN = [
  ["app._index", { index: true }, null],
  ["app.overview", { path: "overview" }, /<s-page/],
  ["app.metrics", { path: "metrics" }, /<s-page/],
  ["app.data-health", { path: "data-health" }, /<s-page/],
  ["app.simulator", { path: "simulator" }, /<s-page/],
  ["app.products", { path: "products" }, /<s-page/],
  ["app.settings._index", { path: "settings" }, /<s-page/],
  ["app.settings.costs", { path: "settings/costs" }, /<s-page/],
  ["app.settings.products", { path: "settings/products" }, /<s-page/],
  ["app.settings.goals", { path: "settings/goals" }, /<s-page/],
  ["app.settings.shop", { path: "settings/shop" }, /<s-page/],
  ["app.settings.marketing", { path: "settings/marketing" }, /<s-page/],
  ["app.settings.connections", { path: "settings/connections" }, /<s-page/],
  ["app.settings.plan", { path: "settings/plan" }, /<s-page/],
  ["app.dashboard", { path: "dashboard" }, null],
];
const TOP = [
  ["_index/route", { index: true }, /<form|<main|<div/],
  ["auth.login/route", { path: "auth/login" }, /<s-page/],
  ["privacy", { path: "privacy" }, /<(main|div|h1)/],
];
const toRoute = (id, mod, extra) => ({ id: `routes/${id}`, ...extra, loader: mod.loader, action: mod.action, Component: mod.default, ErrorBoundary: mod.ErrorBoundary, shouldRevalidate: mod.shouldRevalidate });
const appMod = await load("/app/routes/app.jsx");
const children = [];
for (const [id, extra] of APP_CHILDREN) children.push(toRoute(id, await load(`/app/routes/${id}.jsx`), extra));
const top = [];
for (const [id, extra] of TOP) top.push(toRoute(id.replace("/route", ""), await load(`/app/routes/${id}.jsx`), extra));
const routes = [{ id: "root", path: "/", Component: () => React.createElement(Outlet), children: [...top, { ...toRoute("app", appMod, { path: "app" }), children }] }];
const handler = createStaticHandler(routes);

// ── Rendu ────────────────────────────────────────────────────────────────────────────────────────
let ko = 0, n = 0;
async function renderUrl(url, stateKey) {
  const { db, state } = STATES[stateKey];
  globalThis.__RR_DB = db; globalThis.__RR_STATE = state;
  const ctx = await handler.query(new Request(`http://localhost${url}`, { headers: { "accept-language": "fr-FR,fr;q=0.9" } }));
  if (ctx instanceof Response) return { redirect: ctx.headers.get("Location"), status: ctx.status };
  const router = createStaticRouter(handler.dataRoutes, ctx);
  const html = renderToString(React.createElement(StaticRouterProvider, { router, context: ctx, hydrate: false }));
  return { html, status: ctx.statusCode, errors: ctx.errors };
}
async function check(label, url, stateKey, expect) {
  n++;
  try {
    const r = await renderUrl(url, stateKey);
    const errs = r.errors ? Object.entries(r.errors).map(([k, e]) => `${k}: ${e?.message ?? e?.statusText ?? JSON.stringify(e)}`) : [];
    const ok = !errs.length && expect(r);
    if (!ok) ko++;
    console.log(`  ${ok ? "OK " : "ERR"} [${stateKey}] ${label}${r.redirect ? ` → redirection ${r.redirect}` : ""}${errs.length ? ` → ERREUR ${errs.join(" | ")}` : ""}`);
    if (r.html) console.log(`       ${r.html.length} caractères · ${(r.html.match(/<s-[a-z-]+/g) ?? []).length} composants Polaris`);
    if (!ok && process.env.RR_FULL && r.html) console.log(`       FULL → ${r.html}`);
    if (process.env.RR_DUMP && r.html) (await import("node:fs")).writeFileSync(path.join(process.env.RR_DUMP, `${stateKey}_${label.replace(/[^a-z0-9]+/gi, "_")}.html`), r.html);
  } catch (e) { ko++; console.log(`  ERR [${stateKey}] ${label} → THROW ${e?.constructor?.name}: ${e?.message}`); }
}
const shell = (h) => /<script src="https:\/\/cdn\.shopify\.com\/shopifycloud\/app-bridge\.js" data-api-key="render-check-api-key">/.test(h) && /<script src="https:\/\/cdn\.shopify\.com\/shopifycloud\/polaris\.js">/.test(h) && /<s-app-nav>/.test(h) && !/embedded/.test(h.slice(0, 400));

console.log("=== RENDU RÉEL — routes /app (coquille AppProvider v3 + page) ===");
for (const stateKey of ["empty", "loaded"]) {
  for (const [id, extra, marker] of APP_CHILDREN) {
    const url = `/app${extra.index ? "" : `/${extra.path}`}`;
    if (!marker) { await check(`${id} (redirection attendue)`, url, stateKey, (r) => r.redirect != null); continue; }
    await check(id, url, stateKey, (r) => r.status === 200 && shell(r.html) && marker.test(r.html) && !/THROW|undefined undefined/.test(r.html));
  }
}
console.log("\n=== D2-3 — /app (ancien écran classique) : redirections ===");
await check("/app → Aujourd'hui, paramètres de l'admin conservés", "/app?shop=render-check.myshopify.com&host=abc&embedded=1", "loaded", (r) => r.redirect === "/app/overview?shop=render-check.myshopify.com&host=abc&embedded=1");
await check("retour d'abonnement /app?subscribed=true → Réglages > Offre", "/app?subscribed=true&shop=render-check.myshopify.com", "loaded", (r) => r.redirect === "/app/settings/plan?subscribed=true&shop=render-check.myshopify.com");

console.log("\n=== RENDU RÉEL — pages demandées par paramètres (modes, filtres) ===");
await check("app.simulator ?mode=product", "/app/simulator?mode=product", "loaded", (r) => r.status === 200 && /data-product-picker/.test(r.html) && /Tee/.test(r.html));
await check("app.simulator ?mode=new", "/app/simulator?mode=new", "loaded", (r) => r.status === 200 && /data-mode="new"/.test(r.html) && /name="intent" value="keep_new"/.test(r.html));
await check("app.products ?status=missing&sort=cm2", "/app/products?status=missing&sort=cm2", "loaded", (r) => r.status === 200 && /data-cost-status="missing"/.test(r.html) && !/data-cost-status="set"/.test(r.html) && /data-audit="idle"/.test(r.html));
await check("app.products, offre gratuite : audit verrouillé", "/app/products", "empty", (r) => r.status === 200 && /data-audit="locked"/.test(r.html));
await check("app.settings.products ?product= (panneau)", `/app/settings/products?product=${encodeURIComponent(PRODUCTS[0].id)}`, "loaded", (r) => r.status === 200 && /data-save-bar/.test(r.html));

console.log("\n=== RENDU RÉEL — routes hors /app ===");
for (const [id, extra, marker] of TOP) {
  const url = extra.index ? "/" : `/${extra.path}`;
  await check(id, url, "empty", (r) => (r.redirect != null) || (r.status === 200 && marker.test(r.html)));
}
await check("auth.login : Polaris chargé sans AppProvider ni App Bridge", "/auth/login", "empty", (r) => r.status === 200 && /<script src="https:\/\/cdn\.shopify\.com\/shopifycloud\/polaris\.js">/.test(r.html) && !/app-bridge\.js/.test(r.html) && /<s-text-field/.test(r.html));

console.log(`\n${ko === 0 ? "✅ Toutes les routes rendues" : `❌ ${ko} route(s) en échec`} (${n} rendus)`);
await vite.close();
process.exit(ko === 0 ? 0 : 1);
