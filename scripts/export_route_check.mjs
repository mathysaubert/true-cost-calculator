/* global globalThis */
// ── Preuve serveur : téléchargement du modèle (.xlsx / CSV) et import d'un .xlsx, par la vraie app ──
// Vrai gestionnaire de requêtes React Router (config du projet), vraies routes, vrai shopify.server
// (authenticate.admin avec jeton de session signé). Simulés : Prisma (session), Supabase (mémoire,
// écritures notées), Sentry, API GraphQL Shopify (fetch intercepté). Clés factices posées ici.
// Lancer : node scripts/export_route_check.mjs
import path from "node:path";
import { SignJWT } from "jose";

const SHOP = "render-check.myshopify.com", KEY = "export-check-api-key", SECRET = "export-check-secret";
Object.assign(process.env, { SHOPIFY_API_KEY: KEY, SHOPIFY_API_SECRET: SECRET, SHOPIFY_APP_URL: "https://app.example.test", SCOPES: "read_orders" });

// Catalogue simulé : 3 produits (un renseigné, un avec coût Shopify seul, un sans coût).
const PRODUCTS = [
  { id: "gid://shopify/Product/1", title: "Tee été", variant: "gid://shopify/ProductVariant/11", unitCost: "22.00" },
  { id: "gid://shopify/Product/2", title: "Cap", variant: "gid://shopify/ProductVariant/21", unitCost: "20.00" },
  { id: "gid://shopify/Product/3", title: "Snowboard", variant: "gid://shopify/ProductVariant/31", unitCost: null },
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("myshopify.com")) return realFetch(input, init);
  const body = String(init.body ?? (input instanceof Request ? await input.clone().text() : ""));
  const data = /CostVariants/.test(body)
    ? { products: { edges: PRODUCTS.map((p) => ({ node: { id: p.id, title: p.title, productType: "T-shirt", isGiftCard: false, category: { name: "Apparel" }, variants: { edges: [{ node: { id: p.variant, title: "Default Title", price: "50.00", inventoryItem: { unitCost: p.unitCost ? { amount: p.unitCost } : null } } }], pageInfo: { hasNextPage: false } } } })), pageInfo: { hasNextPage: false, endCursor: null } } }
    : {};
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
};

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const STUBS = { "db.server": path.join(ROOT, "scripts", "stubs", "billing", "db.server.js"), "supabase.server": path.join(ROOT, "scripts", "stubs", "supabase.server.js"), "sentry.server": path.join(ROOT, "scripts", "stubs", "sentry.server.js") };
const stubPlugin = { name: "export-stubs", enforce: "pre", resolveId(s) { if (!s.startsWith(".")) return null; return STUBS[s.split("/").pop().replace(/\.(js|jsx|ts)$/, "")] ?? null; } };

globalThis.__RR_DB = {
  shop_settings: [{ shop_domain: SHOP, shop_currency: "EUR", shop_timezone: "UTC", vat_regime: "assujetti", shipping_model: "stock", default_import_country: "Chine", locale_override: "fr" }],
  variant_costs: [{ shop_domain: SHOP, variant_id: PRODUCTS[0].variant, product_id: PRODUCTS[0].id, prix_achat: 22, port_entrant: 0, qty_par_lot: 1, cout_emballage: 0.3, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Textile", source: "confirmed", customs_confirmed: true }],
};
globalThis.__BILLING_SESSION = { id: `offline_${SHOP}`, shop: SHOP, state: "", isOnline: false, scope: "read_orders", expires: new Date(Date.now() + 3600e3), accessToken: "shpat_fake", refreshToken: null, refreshTokenExpires: null };

const { createServer } = await import("vite");
const vite = await createServer({ root: ROOT, logLevel: "error", server: { middlewareMode: true, hmr: false }, plugins: [stubPlugin] });
const build = await vite.ssrLoadModule("virtual:react-router/server-build");
const { createRequestHandler } = await import("react-router");
const handler = createRequestHandler(build, "development");
const readXlsxFile = (await import("read-excel-file/node")).default;
const writeExcelFile = (await import("write-excel-file/node")).default;

const token = () => new SignJWT({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: KEY, sub: "1", sid: "s1", jti: String(Math.random()) }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 5).setExpirationTime("1m").sign(new TextEncoder().encode(SECRET));
const H = async (extra = {}) => ({ Authorization: `Bearer ${await token()}`, Origin: "https://app.example.test", "X-Forwarded-Host": "app.example.test", "X-Requested-With": "XMLHttpRequest", ...extra });
let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "ERR"} ${m}`); if (!c) ko++; };

console.log("=== Téléchargement .xlsx (route authentifiée) ===");
{
  const res = await handler(new Request("https://app.example.test/app/settings/products/export?format=xlsx", { headers: await H() }));
  const buf = Buffer.from(await res.arrayBuffer());
  ok(res.status === 200 && res.headers.get("Content-Type") === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" && /attachment; filename="true-cost-calculator-costs\.xlsx"/.test(res.headers.get("Content-Disposition") ?? ""), `200, type .xlsx, pièce jointe (${buf.length} octets)`);
  const sheets = await readXlsxFile(buf);
  const costs = sheets[0]?.data ?? [], head = costs[0] ?? [];
  const row = (v) => costs.find((r) => r[0] === v) ?? [];
  ok(sheets.map((s) => s.sheet).join("|") === "Coûts|Valeurs acceptées", "feuilles « Coûts » et « Valeurs acceptées » (locale de la boutique : fr)");
  ok(row(PRODUCTS[0].variant)[head.indexOf("prix_achat")] === 22 && row(PRODUCTS[1].variant)[head.indexOf("prix_achat")] == null && row(PRODUCTS[1].variant)[head.indexOf("suggestion_prix_achat")] === 20 && row(PRODUCTS[2].variant)[head.indexOf("suggestion_prix_achat")] == null, "Tee 22 (saisi) ; Cap vide + suggestion 20 ; Snowboard vide, sans suggestion");
}
console.log("\n=== Téléchargement CSV (second) ===");
{
  const res = await handler(new Request("https://app.example.test/app/settings/products/export?format=csv", { headers: await H() }));
  const bytes = new Uint8Array(await res.arrayBuffer());
  ok(res.status === 200 && /text\/csv/.test(res.headers.get("Content-Type") ?? "") && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, "200, CSV avec marque d'encodage UTF-8");
}
console.log("\n=== Sans jeton de session ===");
{
  const res = await handler(new Request("https://app.example.test/app/settings/products/export?format=xlsx", { headers: { Origin: "https://app.example.test", "X-Forwarded-Host": "app.example.test" } }));
  const ctype = res.headers.get("Content-Type") ?? ""; const page = await res.text(); if (process.env.EXP_DEBUG) console.log("       sans jeton :", res.status, ctype, page.slice(0, 160).replace(/s+/g, " "));
  ok(!/spreadsheetml|text\/csv/.test(ctype), `refusé sans jeton : statut ${res.status}, ${ctype.split(";")[0] || "sans type"}, aucun fichier servi`);
}
console.log("\n=== Import d'un .xlsx (action de la page) ===");
{
  globalThis.__RR_WRITES = [];
  const head = ["variant_id", "product_title", "variant_title", "prix_achat", "port_entrant", "qty_par_lot", "cout_emballage", "vat_regime", "shipping_model", "pays_import", "categorie", "suggestion_prix_achat"];
  const data = [head.map((v) => ({ value: v })),
    [PRODUCTS[1].variant, "Cap", "Default", 18.5, 0, null, 0.2, "assujetti", "stock", "Chine", "Accessoires", 20].map((v) => (v == null ? null : { value: v, type: typeof v === "number" ? Number : String })),
    [PRODUCTS[2].variant, "Snowboard", "Default", null, null, null, null, "assujetti", "stock", "Chine", "Sport", null].map((v) => (v == null ? null : { value: v, type: String }))];
  const file = new File([await writeExcelFile(data).toBuffer()], "couts.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const fd = new FormData(); fd.set("intent", "import_csv"); fd.set("csv", file);
  const res = await handler(new Request("https://app.example.test/app/settings/products.data", { method: "POST", body: fd, headers: await H() }));
  const text = await res.text(); if (process.env.EXP_DEBUG) console.log("       réponse :", text.slice(0, 400));
  const up = globalThis.__RR_WRITES.filter((w) => w.table === "variant_costs" && w.op === "upsert");
  ok(res.status === 200 && up.length === 1 && up[0].rows === 1 && up[0].payload[0].variant_id === PRODUCTS[1].variant && up[0].payload[0].prix_achat === 18.5 && up[0].payload[0].source === "imported", "1 variante importée (Cap, 18,5, source « importé »)");
  // Réponse turbo-stream (valeurs identiques dédupliquées) : la ligne mise de côté est lisible telle quelle.
  ok(/"saved",1/.test(text) && /"incompleteLines"/.test(text) && /ProductVariant\/31","empty",\[[\d,]+\],"prix_achat","port_entrant","cout_emballage"/.test(text) && /"errorCount",0/.test(text), "réponse : 1 importée, 1 à compléter (Snowboard : prix, port, emballage vides), 0 rejet");
}

await vite.close();
console.log(ko === 0 ? "\n✅ Téléchargement et import .xlsx prouvés par la vraie app" : `\n❌ ${ko} contrôle(s) en échec`);
process.exit(ko === 0 ? 0 : 1);
