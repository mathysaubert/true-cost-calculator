/* global globalThis */
// ── Preuve serveur : bouton d'abonnement (Réglages > Offre) → redirection vers la validation Shopify ─
// Vraie chaîne serveur : gestionnaire de requêtes React Router construit par Vite depuis la config du
// projet, vraies routes, vrai shopify.server (authenticate.admin, billing.request). Simulés : Prisma
// (session en mémoire), Supabase (mémoire), Sentry, et l'API GraphQL de Shopify (fetch intercepté,
// aucune requête réseau vers Shopify). Clés : valeurs factices posées ici, jamais lues dans .env.
// Compare la réponse HTTP exacte que reçoit le navigateur (donc App Bridge) dans les deux cas.
// Lancer : node scripts/billing_redirect_check.mjs
import path from "node:path";
import { SignJWT } from "jose";

const SHOP = "render-check.myshopify.com";
const KEY = "billing-check-api-key", SECRET = "billing-check-secret";
Object.assign(process.env, { SHOPIFY_API_KEY: KEY, SHOPIFY_API_SECRET: SECRET, SHOPIFY_APP_URL: "https://app.example.test", SCOPES: "read_orders" });

// API Shopify simulée, installée AVANT le chargement de la bibliothèque (elle capture fetch).
const CONFIRM = `https://admin.shopify.com/store/render-check/charges/1234/confirm_recurring_application_charge?signature=x`;
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("myshopify.com")) return realFetch(input, init);
  const body = String(init.body ?? (input instanceof Request ? await input.clone().text() : ""));
  calls.push(/appSubscriptionCreate/.test(body) ? "appSubscriptionCreate" : /partnerDevelopment|plan/.test(body) ? "shop.plan" : body.slice(0, 60));
  const data = /appSubscriptionCreate/.test(body)
    ? { appSubscriptionCreate: { appSubscription: { id: "gid://shopify/AppSubscription/1" }, confirmationUrl: CONFIRM, userErrors: [] } }
    : { shop: { plan: { partnerDevelopment: true, displayName: "Developer Preview" } }, currentAppInstallation: { allSubscriptions: { edges: [] }, activeSubscriptions: [] } };
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const STUBS = {
  "db.server": path.join(ROOT, "scripts", "stubs", "billing", "db.server.js"),
  "supabase.server": path.join(ROOT, "scripts", "stubs", "supabase.server.js"),
  "sentry.server": path.join(ROOT, "scripts", "stubs", "sentry.server.js"),
};
const stubPlugin = { name: "billing-stubs", enforce: "pre", resolveId(source) { if (!source.startsWith(".")) return null; const b = source.split("/").pop().replace(/\.(js|jsx|ts)$/, ""); return STUBS[b] ?? null; } };

globalThis.__RR_DB = { shop_settings: [{ shop_domain: SHOP, is_dev_shop: true, shop_currency: "EUR", shop_timezone: "UTC" }] };
globalThis.__BILLING_SESSION = { id: `offline_${SHOP}`, shop: SHOP, state: "", isOnline: false, scope: "read_orders", expires: new Date(Date.now() + 3600e3), accessToken: "shpat_fake", refreshToken: null, refreshTokenExpires: null };

const { createServer } = await import("vite");
const vite = await createServer({ root: ROOT, logLevel: "error", server: { middlewareMode: true, hmr: false }, plugins: [stubPlugin] });
const build = await vite.ssrLoadModule("virtual:react-router/server-build");
const { createRequestHandler } = await import("react-router");
const handler = createRequestHandler(build, "development");

const token = async () => new SignJWT({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: KEY, sub: "1", sid: "s1", jti: String(Math.random()) })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 5).setExpirationTime("1m").sign(new TextEncoder().encode(SECRET));

async function post(label, url, body, contentType) {
  calls.length = 0;
  const res = await handler(new Request(`https://app.example.test${url}`, {
    method: "POST", body,
    headers: { "Content-Type": contentType, Authorization: `Bearer ${await token()}`, Origin: "https://app.example.test", "X-Forwarded-Host": "app.example.test", "X-Requested-With": "XMLHttpRequest" },
  }));
  const text = await res.text();
  console.log(`\n=== ${label} ===`);
  console.log(`  POST ${url}`);
  console.log(`  statut HTTP : ${res.status}`);
  console.log(`  en-tête de redirection App Bridge : ${res.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url") ?? "(absent)"}`);
  console.log(`  appels Shopify simulés : ${calls.join(", ") || "(aucun)"}`);
  console.log(`  corps (début) : ${text.slice(0, 220).replace(/\s+/g, " ")}`);
  return { status: res.status, reauth: res.headers.get("X-Shopify-API-Request-Failure-Reauthorize-Url"), text };
}

const offre = await post("Réglages > Offre (formulaire, intent=subscribe_pro)", "/app/settings/plan.data", new URLSearchParams({ intent: "subscribe_pro" }).toString(), "application/x-www-form-urlencoded");
await vite.close();
// D2-3 (2026-09-26) : l'écran classique est supprimé ; seule la page Offre porte l'abonnement.
const good = offre.status === 401 && typeof offre.reauth === "string" && offre.reauth.includes("/charges/");
console.log(`\n${good ? "✅" : "❌"} Offre : 401 + en-tête de redirection App Bridge vers la page de validation Shopify`);
process.exitCode = good ? 0 : 1;
process.exit(process.exitCode ?? 0);
