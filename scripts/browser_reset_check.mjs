// ── Preuve dans un VRAI navigateur : « Annuler » de la barre de sauvegarde sur les Réglages ──────
// Vrai polaris.js (CDN Shopify), React 19, vrais composants Fields.jsx, et le code de suivi de
// formulaire de la barre de sauvegarde extrait TEL QUEL d'app-bridge.js (focusin/beforeinput
// mémorisent la valeur, « Annuler » = form.reset() puis réécriture des valeurs mémorisées).
// Navigateur : Edge (ou Chrome) installé, piloté par playwright-core (outil de test, aucun
// téléchargement). Réseau requis : polaris.js et app-bridge.js viennent du CDN Shopify.
// Lancer : node scripts/browser_reset_check.mjs   (BR_HEADED=1 pour voir le navigateur)
import { createServer } from "vite";
import { chromium } from "playwright-core";

const POLARIS = "https://cdn.shopify.com/shopifycloud/polaris.js";
const APP_BRIDGE = "https://cdn.shopify.com/shopifycloud/app-bridge.js";

// Code de la barre de sauvegarde, extrait d'app-bridge.js : constantes + K (suivi) et ses aides.
const ab = await (await fetch(APP_BRIDGE)).text();
const cut = (from, to) => { const a = ab.indexOf(from), b = ab.indexOf(to, a); if (a < 0 || b < 0) throw new Error(`app-bridge.js : repère introuvable (${from})`); return ab.slice(a, b); };
const saveBarCode = `${cut("const N=Symbol()", "function Z(t,{onChange")}${cut("function tt(t){", "class st{")};window.__abK=K;`;

const vite = await createServer({ configFile: false, root: process.cwd(), logLevel: "error", server: { port: 5199, strictPort: false, hmr: false }, esbuild: { jsx: "automatic" }, appType: "mpa" });
await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, "");
// Rendu serveur réel (Node) de la page Objectifs, pour le chemin « page chargée en entier ».
const { renderToString } = await import("react-dom/server");
const { tree } = await vite.ssrLoadModule("/scripts/browser/reset-tree.jsx");
const SSR_HTML = renderToString(tree("goals"));

const browser = await chromium.launch({ channel: process.env.BR_CHANNEL || "msedge", headless: !process.env.BR_HEADED });
let ko = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK " : "ERR"} ${msg}`); if (!cond) ko++; };

async function openPage({ polarisFirst }) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`       [page] ${e.message}`));
  await page.goto(`${base}/scripts/browser/reset.html`);
  await page.waitForFunction(() => window.__ready === true);
  await page.addScriptTag({ content: saveBarCode });
  // Barre de sauvegarde installée au chargement de l'app, comme App Bridge dans l'admin.
  await page.evaluate(() => { window.__saveBar = null; window.__abK(document, { onChange: (s) => { window.__saveBar = s ?? null; } }); });
  if (polarisFirst) { await page.addScriptTag({ url: POLARIS }); await page.waitForFunction(() => !!customElements.get("s-text-field")); }
  return page;
}
const state = (page) => page.evaluate(() => {
  const one = (n) => { const el = document.querySelector(`[name="${n}"]`); const inner = el?.shadowRoot?.querySelector("input, select"); return { value: el?.value ?? null, defaultValue: el?.defaultValue ?? null, attr: el?.getAttribute("value") ?? null, inner: inner?.value ?? null }; };
  return { threshold: one("profitability_threshold_pct"), shipping: one("shipping_default"), vat: one("vat_regime"), saveBar: !!window.__saveBar };
});
async function typeInto(page, name, text) {
  const input = page.locator(`s-text-field[name="${name}"] input`);
  await input.click();
  await input.press("Control+A");
  await input.pressSequentially(text);
}
async function discard(page) { await page.evaluate(() => window.__saveBar?.discardButton?.onAction()); await page.waitForTimeout(150); }

async function scenario(label, { path }) {
  console.log(`
=== ${label} ===`);
  const page = await openPage({ polarisFirst: true });
  if (path === "menu") { await page.evaluate(() => window.__render("home")); await page.waitForTimeout(100); await page.evaluate(() => window.__render("goals")); }
  else await page.evaluate((html) => window.__hydrate(html), SSR_HTML);
  await page.waitForFunction(() => !!document.querySelector('[name="profitability_threshold_pct"]')?.shadowRoot?.querySelector("input"));
  await page.waitForTimeout(200);
  const s0 = await state(page);
  console.log(`       affiché : objectif ${JSON.stringify(s0.threshold)} ; port ${JSON.stringify(s0.shipping)} ; TVA ${JSON.stringify(s0.vat)}`);
  ok(s0.threshold.inner === "45" && s0.shipping.inner === "4.9", "valeurs enregistrées affichées (45, 4.9)");
  await typeInto(page, "profitability_threshold_pct", "60");
  await typeInto(page, "shipping_default", "7");
  await page.locator('s-select[name="vat_regime"] select').selectOption("assujetti");
  const s1 = await state(page);
  console.log(`       après saisie : objectif ${JSON.stringify(s1.threshold)} ; port ${JSON.stringify(s1.shipping)} ; barre ${s1.saveBar}`);
  ok(s1.saveBar && s1.threshold.inner === "60" && s1.vat.value === "assujetti", "saisie 60 et 7, TVA passée à « assujetti » : barre de sauvegarde affichée");
  await discard(page);
  const s2 = await state(page);
  console.log(`       après Annuler : objectif ${JSON.stringify(s2.threshold)} ; port ${JSON.stringify(s2.shipping)} ; TVA ${JSON.stringify(s2.vat)} ; barre ${s2.saveBar}`);
  ok(s2.threshold.value === "45" && s2.threshold.inner === "45", "« Annuler » : l'objectif revient à 45");
  ok(s2.shipping.value === "4.9" && s2.shipping.inner === "4.9", "« Annuler » : le port revient à 4.9");
  ok(s2.vat.value === "franchise" && s2.vat.inner === "franchise", "« Annuler » : la TVA revient à « franchise »");
  ok(!s2.saveBar, "« Annuler » : la barre de sauvegarde disparaît");
  if (path === "reload") { const errs = await page.evaluate(() => window.__hydrationErrors ?? []); ok(errs.length === 0, `aucune erreur d'hydratation (${errs.length})`); }
  // Après un enregistrement : nouvelle valeur enregistrée 50, puis saisie et « Annuler ».
  await page.evaluate(() => window.__render("goals", { threshold: 50, shipping: 4.9, vat: "franchise" }));
  await page.waitForTimeout(150);
  await typeInto(page, "profitability_threshold_pct", "70");
  await discard(page);
  const s3 = await state(page);
  ok(s3.threshold.value === "50" && s3.threshold.inner === "50", `après un enregistrement à 50, « Annuler » remet 50 (${s3.threshold.inner})`);
  await page.close();
}

await scenario("Arrivée par le menu (rendu client, Polaris déjà chargé)", { path: "menu" });
await scenario("Page chargée en entier (HTML serveur, mise à niveau Polaris, hydratation)", { path: "reload" });

await browser.close();
await vite.close();
console.log(`\n${ko === 0 ? "✅ « Annuler » remet les valeurs enregistrées dans le vrai navigateur" : `❌ ${ko} contrôle(s) en échec`}`);
process.exit(ko === 0 ? 0 : 1);
