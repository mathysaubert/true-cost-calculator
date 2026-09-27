// ── Preuve navigateur : les boutons d'abonnement de Réglages > Offre envoient bien leur formulaire ──
// Vrai Edge (playwright-core), vrai polaris.js, vrai composant PlanCards dans un routeur de données
// React Router ; témoin : un formulaire « Retenir » identique à celui du Simulateur (test boutique 5 OK).
// La suite serveur (billing.request → 401 + en-tête de redirection App Bridge) est prouvée par
// scripts/billing_redirect_check.mjs. Lancer : node scripts/browser_plan_check.mjs
import { createServer } from "vite";
import { chromium } from "playwright-core";

const vite = await createServer({ configFile: false, root: process.cwd(), logLevel: "error", server: { port: 5197, strictPort: false, hmr: false }, esbuild: { jsx: "automatic" }, appType: "mpa" });
await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ channel: process.env.BR_CHANNEL || "msedge", headless: !process.env.BR_HEADED });
const page = await browser.newPage();
await page.goto(`${base}/scripts/browser/plan.html`);
await page.waitForFunction(() => window.__ready === true);
await page.addScriptTag({ url: "https://cdn.shopify.com/shopifycloud/polaris.js" });
await page.waitForFunction(() => !!customElements.get("s-button"));
await page.waitForTimeout(400);
let ko = 0;
for (const [label, intent] of [["Choisir Pro", "subscribe_pro"], ["Choisir Expert", "subscribe_expert"], ["Retenir ce scénario", "keep"]]) {
  const before = await page.evaluate(() => window.__submits.length);
  await page.locator("s-button", { hasText: label }).click();
  await page.waitForTimeout(500);
  const sent = await page.evaluate((n) => window.__submits.slice(n), before);
  const ok = sent.length === 1 && sent[0] === intent;
  if (!ok) ko++;
  console.log(`  ${ok ? "OK " : "ERR"} clic « ${label} » → formulaire envoyé avec intent=${sent.join(",") || "(rien)"}`);
}
// D2-1 — App Pricing allumée : l'app tourne dans un iframe de l'admin ; « Changer d'offre » doit ouvrir la
// page d'offres de Shopify dans la fenêtre PRINCIPALE (target _top), jamais dans l'iframe.
{
  const top = await browser.newPage();
  const shopifyHits = [];
  await top.route("https://admin.shopify.com/**", (route) => { shopifyHits.push(route.request().url()); return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Shopify pricing</title>page d'offres" }); });
  await top.setContent(`<iframe id="app" src="${base}/scripts/browser/plan.html?pricing=1" style="width:1200px;height:900px"></iframe>`);
  const frame = await (await top.waitForSelector("#app")).contentFrame();
  await frame.waitForFunction(() => window.__ready === true);
  await frame.addScriptTag({ url: "https://cdn.shopify.com/shopifycloud/polaris.js" });
  await frame.waitForFunction(() => !!customElements.get("s-button"));
  await frame.waitForTimeout(400);
  const noForm = await frame.evaluate(() => !document.querySelector('input[name="intent"][value^="subscribe_"]'));
  await Promise.all([top.waitForURL("https://admin.shopify.com/**", { timeout: 5000 }).catch(() => null), frame.locator("s-button", { hasText: "Changer d'offre" }).click()]);
  const okTop = top.url() === "https://admin.shopify.com/store/tcc-tarif-test/charges/tcc-tarification-test/pricing_plans" && shopifyHits.length === 1;
  if (!okTop || !noForm) ko++;
  console.log(`  ${noForm ? "OK " : "ERR"} App Pricing allumée : aucun formulaire d'abonnement sur les cartes`);
  console.log(`  ${okTop ? "OK " : "ERR"} clic « Changer d'offre » dans l'iframe → la fenêtre principale ouvre la page d'offres de Shopify (${top.url()})`);
  await top.close();
}
await browser.close();
await vite.close();
console.log(ko === 0 ? "✅ Les boutons d'abonnement envoient leur formulaire ; « Changer d'offre » ouvre la page d'offres de Shopify" : `❌ ${ko} contrôle(s) en échec`);
process.exit(ko === 0 ? 0 : 1);
