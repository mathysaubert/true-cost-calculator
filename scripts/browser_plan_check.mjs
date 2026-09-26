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
await browser.close();
await vite.close();
console.log(ko === 0 ? "✅ Les boutons d'abonnement envoient leur formulaire" : `❌ ${ko} bouton(s) sans envoi`);
process.exit(ko === 0 ? 0 : 1);
