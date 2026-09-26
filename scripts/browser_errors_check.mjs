// ── Preuve dans un VRAI navigateur (Edge) : bandeau des commandes de test ; erreurs en build minifié ──
// 1. Bandeau (vrai composant DevShopBanner) sur une page Produits : le clic appelle l'action
//    d'Aujourd'hui, la page reste affichée et ses données sont rechargées.
// 2. Build de PRODUCTION (vite build, minifié) : la réponse d'authentification Shopify levée par une
//    route. Avec boundary.error de Shopify et l'ancienne page racine : « [object Object] » (défaut vu
//    en boutique). Avec embeddedErrorBoundary : la page de Shopify s'affiche. Avec la nouvelle page
//    racine : message lisible et traduit, jamais « [object Object] ».
// Lancer : node scripts/browser_errors_check.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, build, preview } from "vite";
import { chromium } from "playwright-core";

const ROOT = process.cwd();
let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "ERR"} ${m}`); if (!c) ko++; };
const browser = await chromium.launch({ channel: process.env.BR_CHANNEL || "msedge", headless: !process.env.BR_HEADED });

console.log("=== 1. Bandeau « Inclure les commandes de test » sur la page Produits ===");
{
  const vite = await createServer({ configFile: false, root: ROOT, logLevel: "error", server: { port: 5195, strictPort: false, hmr: false }, esbuild: { jsx: "automatic" }, appType: "mpa" });
  await vite.listen();
  const base = vite.resolvedUrls.local[0].replace(/\/$/, "");
  const page = await browser.newPage();
  await page.goto(`${base}/scripts/browser/errors.html`);
  await page.waitForFunction(() => window.__ready === true);
  await page.addScriptTag({ url: "https://cdn.shopify.com/shopifycloud/polaris.js" });
  await page.waitForFunction(() => !!customElements.get("s-button"));
  await page.evaluate(() => window.__router.navigate("/app/products"));
  await page.waitForSelector("#loads");
  const before = await page.evaluate(() => ({ loads: document.querySelector("#loads").textContent, label: document.querySelector("[data-dev-toggle] s-button").textContent }));
  await page.locator("[data-dev-toggle] s-button").click();
  await page.waitForFunction((n) => document.querySelector("#loads")?.textContent !== n, before.loads, { timeout: 5000 }).catch(() => null);
  const after = await page.evaluate(() => ({ where: document.querySelector("#where")?.textContent, loads: document.querySelector("#loads")?.textContent, label: document.querySelector("[data-dev-toggle] s-button")?.textContent, actions: window.__state.actions, error: document.body.textContent.includes("n'est pas disponible") }));
  ok(after.actions.join() === "toggle_test_orders", "clic sur Produits → action d'Aujourd'hui appelée (toggle_test_orders)");
  ok(after.where === "/app/products" && !after.error, "la page Produits reste affichée, sans « Cette action n'est pas disponible »");
  ok(Number(after.loads) > Number(before.loads) && after.label !== before.label, `données de Produits rechargées (chargements ${before.loads} → ${after.loads}), libellé du bouton basculé`);
  await page.close();
  await vite.close();
}

console.log("\n=== 2. Build de production minifié : réponse d'authentification Shopify ===");
{
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "tcc-errors-min-"));
  await build({ configFile: false, root: path.join(ROOT, "scripts", "browser"), logLevel: "error", base: "/", esbuild: { jsx: "automatic" }, build: { outDir: out, emptyOutDir: true, minify: true, rollupOptions: { input: path.join(ROOT, "scripts", "browser", "errors-min.html") } } });
  const js = fs.readdirSync(path.join(out, "assets")).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(out, "assets", f), "utf8")).join("\n");
  ok(!/class ErrorResponseImpl/.test(js) && /constructor\.name==="ErrorResponseImpl"/.test(js), "bundle minifié : la classe d'erreur de React Router a perdu son nom, le test de Shopify par nom est présent (conditions de production)");
  const server = await preview({ configFile: false, root: path.join(ROOT, "scripts", "browser"), logLevel: "error", build: { outDir: out }, preview: { port: 5194, strictPort: false }, appType: "spa" });
  const base = server.resolvedUrls.local[0].replace(/\/$/, "");
  const run = async (rootKind, child) => {
    const page = await browser.newPage();
    await page.goto(`${base}/errors-min.html?root=${rootKind}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.evaluate((c) => window.__router.navigate(`/${c}?root=${new URLSearchParams(location.search).get("root")}`), child);
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ bounce: !!document.querySelector("#bounce"), root: document.querySelector("#root-error")?.textContent ?? null }));
    await page.close();
    return r;
  };
  const a = await run("old", "shopify");
  ok(!a.bounce && /\[object Object\]/.test(a.root ?? ""), `avant (boundary.error + ancienne racine) : « ${a.root} » — défaut de la boutique reproduit`);
  const b = await run("new", "ours");
  ok(b.bounce && b.root === null, "après (embeddedErrorBoundary) : la page d'authentification de Shopify s'affiche, pas d'erreur");
  const c = await run("new", "shopify");
  ok(!/\[object Object\]/.test(c.root ?? "") && /Une erreur est survenue/.test(c.root ?? "") && /Code 200|La page n'a pas pu s'afficher/.test(c.root ?? ""), `filet : nouvelle racine avec une erreur non reconnue → « ${c.root} »`);
  await server.close();
  fs.rmSync(out, { recursive: true, force: true });
}

await browser.close();
console.log(ko === 0 ? "\n✅ Bandeau et erreurs prouvés dans le vrai navigateur (build minifié compris)" : `\n❌ ${ko} contrôle(s) en échec`);
process.exit(ko === 0 ? 0 : 1);
