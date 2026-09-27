// ── Preuve dans un VRAI navigateur, sur la VRAIE app de test : navigation entre écrans (défaut « page Offre vide ») ──
// Vrai serveur de développement (react-router dev) de l'app de test « TCC Tarification test », avec
// l'environnement du lanceur d2_0_dev.mjs : base tcc-test UNIQUEMENT (garde-fous du lanceur refaits ici),
// vraie boutique tcc-tarif-test (session hors ligne de tcc-test), vrai Edge et vrai polaris.js.
// L'admin Shopify est remplacé par un jeton de session signé avec le secret de l'app de TEST (jamais la
// vraie app), posé sur chaque requête comme le ferait App Bridge ; app-bridge.js est remplacé par un
// bouchon inerte (hors de l'admin, le vrai script renverrait vers admin.shopify.com).
// Mesure : navigation client Objectifs → Offre (et témoin Objectifs → Boutique), erreurs de la page,
// réponses des requêtes de données, contenu affiché. Lancer : node scripts/browser_embedded_nav_check.mjs
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { SignJWT } from "jose";
import { chromium } from "playwright-core";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const PORT = 5299;
const BASE = `http://localhost:${PORT}`;
const parse = (f) => Object.fromEntries(fs.readFileSync(path.join(ROOT, f), "utf8").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const fail = (m) => { console.error(`ÉCHEC : ${m}`); process.exit(1); };

// Garde-fous : la preuve du lanceur (base tcc-test, app de test) doit passer avant tout lancement.
const proof = spawnSync(process.execPath, [path.join(ROOT, "scripts", "d2_0_dev.mjs"), "check"], { cwd: ROOT, encoding: "utf8" });
if (proof.status !== 0) fail("preuve du lanceur en échec : " + String(proof.stdout + proof.stderr).split("\n").filter(Boolean).slice(-2).join(" | "));
console.log("garde-fous du lanceur : OK (base tcc-test, app de test)");

const prod = parse(".env"), test = parse(".env.test"), e = parse(".env.tcc-tarif-test");
const env = { ...process.env };
for (const k of [...Object.keys(prod), ...Object.keys(test)]) delete env[k];
Object.assign(env, e, { SHOPIFY_APP_URL: BASE, PORT: String(PORT), NODE_ENV: "development" });
const SHOP = test.PRICING_TEST_SHOP, KEY = e.SHOPIFY_API_KEY, SECRET = e.SHOPIFY_API_SECRET;
const token = () => new SignJWT({ iss: `https://${SHOP}/admin`, dest: `https://${SHOP}`, aud: KEY, sub: "1", sid: "nav-check", jti: String(Math.random()) })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setNotBefore(Math.floor(Date.now() / 1000) - 5).setExpirationTime("1m").sign(new TextEncoder().encode(SECRET));

const server = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["react-router", "dev", "--port", String(PORT), "--strictPort"], { cwd: ROOT, env, shell: process.platform === "win32" });
let log = "";
server.stdout.on("data", (d) => { log += String(d).replace(/[[0-9;]*m/g, ""); });
server.stderr.on("data", (d) => { log += String(d).replace(/[[0-9;]*m/g, ""); });
const stop = () => { try { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]); else server.kill(); } catch { /* déjà arrêté */ } };
for (let i = 0; i < 120 && !/Local:/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
if (!/Local:/.test(log)) { stop(); fail("serveur de développement non démarré : " + log.replace(/postgres(ql)?:\/\/\S+/g, "<url>").split("\n").filter(Boolean).slice(-8).join(" | ")); }

const browser = await chromium.launch({ channel: process.env.BR_CHANNEL || "msedge", headless: !process.env.BR_HEADED });
// Agent d un Edge normal : la bibliothèque Shopify refuse les robots (HeadlessChrome → 410 Gone).
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0" });
const errors = [], data = [];
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message} @ ${(err.stack || "").split("\n").slice(1, 3).join(" ").trim().slice(0, 200)}`));
page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url().slice(0,120)} ${r.failure()?.errorText}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
page.on("response", (r) => { const t = r.request().resourceType(); if (t === "document" || t === "fetch" || t === "xhr") data.push(`${t} ${r.status()} ${r.url().replace(BASE, "").replace(/id_token=[^&]+/, "id_token=…").slice(0, 90)}`); });
await page.route("https://cdn.shopify.com/shopifycloud/app-bridge.js", (route) => route.fulfill({ contentType: "text/javascript", body: "window.shopify = new Proxy({}, { get: (t, k) => k === 'idToken' ? async () => '' : new Proxy(function () {}, { get: () => () => {}, apply: () => undefined }) });" }));
await page.route(`${BASE}/**`, async (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${await token()}` } }));

const host = Buffer.from(`admin.shopify.com/store/${SHOP.replace(".myshopify.com", "")}`).toString("base64url");
const qs = `embedded=1&shop=${SHOP}&host=${host}&id_token=${await token()}`;
let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "ERR"} ${m}`); if (!c) ko++; };
const state = () => page.evaluate(() => ({ url: location.pathname, plan: !!document.querySelector("[data-current-plan], [data-plan]"), goals: !!document.querySelector('[name="profitability_threshold_pct"]'), shop: !!document.querySelector('[name="shop_country_code"], [data-settings-shop], s-select[name]'), text: (document.querySelector(".tcc")?.innerText ?? "").slice(0, 120).replace(/\s+/g, " ") }));

async function navigate(label, fromPath, linkText, expect) {
  errors.length = 0; data.length = 0;
  const res = await page.goto(`${BASE}${fromPath}?${qs}`, { waitUntil: "networkidle" });
  // Hydratation terminée (routeur de données React Router en place) avant de cliquer : en développement,
  // Vite sert des centaines de modules, un clic trop tôt part en navigation de document.
  await page.waitForFunction(() => !!window.__reactRouterDataRouter || !!window.__reactRouterRouter, null, { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(1500);
  const before = await state();
  console.log(`  premier chargement, erreurs : ${errors.join(" || ").slice(0, 1500) || "(aucune)"} ; routeur hydraté : ${await page.evaluate(() => !!(window.__reactRouterRouter || window.__reactRouterDataRouter || window.__reactRouterContext?.isSpaMode !== undefined))}`);
  if (!before.goals) {
    const body = await page.evaluate(() => document.body?.innerText?.slice(0, 300).replace(/\s+/g, " ") ?? "");
    console.log(`  chargement de ${fromPath} : HTTP ${res?.status()} ; adresse ${page.url().replace(/id_token=[^&]+/, "id_token=…")} ; texte « ${body} » ; erreurs : ${errors.slice(0, 4).join(" | ") || "(aucune)"}`);
  }
  // Navigation CLIENT (comme dans l'admin, app hydratée) : le routeur de données React Router charge les
  // données par une requête .data puis dessine l'écran dans le navigateur. Sans routeur : clic sur le lien.
  const target = await page.locator(`a:has-text("${linkText}")`).first().getAttribute("href");
  const viaRouter = await page.evaluate((to) => { const r = window.__reactRouterDataRouter; if (!r) return false; r.navigate(to); return true; }, target);
  if (!viaRouter) await page.locator(`a:has-text("${linkText}"), s-link:has-text("${linkText}")`).first().click();
  console.log(`  navigation ${viaRouter ? "client (routeur React Router)" : "par clic"} vers ${target}`);
  await page.waitForTimeout(3000);
  const after = await state();
  console.log(`\n=== ${label} ===`);
  console.log(`  avant : ${before.url} ; après : ${after.url}`);
  console.log(`  requêtes de données : ${data.join(" | ") || "(aucune)"}`);
  console.log(`  erreurs de la page : ${errors.length ? errors.slice(0, 6).join(" | ") : "(aucune)"}`);
  console.log(`  contenu affiché : « ${after.text} »`);
  ok(expect(after), `${label} : écran attendu affiché sans rechargement`);
  await page.screenshot({ path: path.join(ROOT, "node_modules", ".cache", `nav_${label.replace(/\W+/g, "_")}.png`) });
  return { before, after };
}

try {
  fs.mkdirSync(path.join(ROOT, "node_modules", ".cache"), { recursive: true });
  await navigate("Objectifs vers Boutique (témoin)", "/app/settings/goals", "Boutique", (s) => s.url === "/app/settings/shop");
  await navigate("Objectifs vers Offre", "/app/settings/goals", "Offre", (s) => s.url === "/app/settings/plan" && s.plan);
} finally {
  await browser.close();
  stop();
}
console.log(ko === 0 ? "\n✅ Navigation vers l'écran Offre prouvée dans le vrai navigateur, sur la vraie app de test" : `\n❌ ${ko} navigation(s) en échec`);
process.exit(ko === 0 ? 0 : 1);
