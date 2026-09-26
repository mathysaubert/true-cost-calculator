// ── Preuve dans un VRAI navigateur : téléchargement du modèle Excel (.xlsx) et CSV des coûts produits ──
// Vrai Edge (playwright-core), vrai polaris.js, vrai composant CostsCsv. Le clic appelle la route
// d'export par fetch (dans l'admin, App Bridge y ajoute le jeton de session) ; Playwright sert cette
// route avec le fichier produit par le code serveur réel (buildCostsXlsx / costsCsvTemplate), puis
// récupère le fichier téléchargé par le navigateur et le relit. La route elle-même (authentification,
// en-têtes) est prouvée par scripts/export_route_check.mjs.
// Lancer : node scripts/browser_export_check.mjs
import fs from "node:fs";
import { createServer } from "vite";
import { chromium } from "playwright-core";
import readXlsxFile from "read-excel-file/node";
import { buildCostRowsForDisplay } from "../app/lib/variantCosts.js";
import { buildCostsXlsx } from "../app/lib/costsXlsx.server.js";
import { costsCsvTemplate } from "../app/lib/costsCsv.js";

const gid = (n) => `gid://shopify/ProductVariant/${n}`;
const rows = buildCostRowsForDisplay({
  variants: [
    { variant_id: gid(1), product_id: "p1", product_title: "Tee été", variant_title: "M", price: 50, unitCost: "22" },
    { variant_id: gid(2), product_id: "p2", product_title: "The Collection Snowboard: Oxygen", variant_title: "Default Title", price: 1025, unitCost: null },
  ],
  storedMap: new Map([[gid(1), { variant_id: gid(1), prix_achat: 21.5, port_entrant: 0, qty_par_lot: 1, cout_emballage: 0.3, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Électronique", source: "confirmed" }]]),
  defaultCountry: "Chine", vatRegime: "assujetti", shippingModel: "stock",
});
const XLSX = await buildCostsXlsx(rows, { costs: "Coûts", values: "Valeurs acceptées" });
const CSV = Buffer.from(costsCsvTemplate(rows, { bom: true }), "utf8");

const vite = await createServer({ configFile: false, root: process.cwd(), logLevel: "error", server: { port: 5196, strictPort: false, hmr: false }, esbuild: { jsx: "automatic" }, appType: "mpa" });
await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ channel: process.env.BR_CHANNEL || "msedge", headless: !process.env.BR_HEADED });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
let ko = 0;
const ok = (c, m) => { console.log(`  ${c ? "OK " : "ERR"} ${m}`); if (!c) ko++; };

const requests = [];
let mode = "ok";
await page.route("**/app/settings/products/export**", async (route) => {
  const req = route.request(), url = new URL(req.url());
  requests.push({ format: url.searchParams.get("format"), type: req.resourceType(), method: req.method() });
  if (mode === "error") return route.fulfill({ status: 500, body: "boom" });
  if (mode === "slow") await new Promise((r) => setTimeout(r, 1200));
  const xlsx = url.searchParams.get("format") !== "csv";
  return route.fulfill({ status: 200, body: xlsx ? XLSX : CSV, headers: { "Content-Type": xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="true-cost-calculator-costs.${xlsx ? "xlsx" : "csv"}"` } });
});
await page.goto(`${base}/scripts/browser/export.html`);
await page.waitForFunction(() => window.__ready === true);
await page.addScriptTag({ url: "https://cdn.shopify.com/shopifycloud/polaris.js" });
await page.waitForFunction(() => !!customElements.get("s-button"));
await page.waitForTimeout(300);

console.log("=== Modèle Excel (.xlsx) ===");
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('s-button[data-export="xlsx"]').click()]);
  const file = await dl.path();
  const sheets = await readXlsxFile(fs.readFileSync(file));
  const costs = sheets[0]?.data ?? [], head = costs[0] ?? [];
  ok(requests.at(-1)?.format === "xlsx" && requests.at(-1)?.type === "fetch" && requests.at(-1)?.method === "GET", "clic → requête fetch GET vers la route d'export (format=xlsx)");
  ok(dl.suggestedFilename() === "true-cost-calculator-costs.xlsx", `fichier reçu par le navigateur : ${dl.suggestedFilename()}`);
  ok(sheets.map((s) => s.sheet).join("|") === "Coûts|Valeurs acceptées" && costs.length === 3, "fichier relu : feuilles « Coûts » et « Valeurs acceptées », 2 variantes");
  const tee = costs.find((r) => r[0] === gid(1)) ?? [], board = costs.find((r) => r[0] === gid(2)) ?? [];
  ok(tee[head.indexOf("prix_achat")] === 21.5 && tee[head.indexOf("categorie")] === "Électronique" && tee[head.indexOf("product_title")] === "Tee été", "Tee : 21,5 en nombre, accents intacts");
  ok(board[head.indexOf("prix_achat")] == null && board[head.indexOf("port_entrant")] == null, "Snowboard sans coût saisi : cellules vides (non renseigné)");
}
console.log("\n=== CSV (UTF-8) ===");
{
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('s-button[data-export="csv"]').click()]);
  const bytes = fs.readFileSync(await dl.path());
  ok(requests.at(-1)?.format === "csv" && dl.suggestedFilename() === "true-cost-calculator-costs.csv", "clic → requête format=csv, fichier true-cost-calculator-costs.csv");
  ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && bytes.toString("utf8").includes("Électronique"), "marque d'encodage UTF-8 en tête, « Électronique » intact");
}
console.log("\n=== Attente et erreur ===");
{
  mode = "slow";
  const click = page.locator('s-button[data-export="xlsx"]').click();
  await page.waitForTimeout(300);
  const pending = await page.evaluate(() => { const b = document.querySelector('s-button[data-export="xlsx"]'); const c = document.querySelector('s-button[data-export="csv"]'); return { loading: b?.hasAttribute("loading") || b?.loading === true || b?.loading === "true", disabled: !!(c?.disabled) || c?.hasAttribute("disabled") }; });
  await click; await page.waitForEvent("download");
  ok(pending.loading && pending.disabled, "pendant la préparation : bouton .xlsx en chargement, bouton CSV désactivé");
  mode = "error";
  await page.locator('s-button[data-export="xlsx"]').click();
  await page.waitForSelector("[data-export-error]", { timeout: 5000 }).catch(() => null);
  const msg = await page.evaluate(() => document.querySelector("[data-export-error]")?.textContent ?? "");
  ok(/n'a pas pu être préparé/.test(msg), `erreur serveur : message affiché (« ${msg.trim()} »)`);
}

await browser.close();
await vite.close();
console.log(ko === 0 ? "\n✅ Téléchargement .xlsx et CSV prouvé dans le vrai navigateur" : `\n❌ ${ko} contrôle(s) en échec`);
process.exit(ko === 0 ? 0 : 1);
