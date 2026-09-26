// ════════════════════════════════════════════════════════════════════════════════
//  LOT 39 — Trois défauts vus en boutique (2026-09-26).
//  1. Bandeau « Inclure les commandes de test » : action d'Aujourd'hui par un fetcher, sur toutes
//     les pages qui l'affichent (avant : action de la page courante → « Cette action n'est pas disponible »).
//  2. Écran classique depuis l'état vide : lien React Router ; erreurs de route reconnues sans le nom de
//     classe (minifié en production) ; page d'erreur racine lisible et traduite, jamais « [object Object] ».
//  3. Taux de retour de l'audit : « aucune commande » n'est pas « il manque 1 commande ».
//  Pour lancer : node tests/lot39_test_defects.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "node:fs";
import { returnRateFromKpis } from "../app/lib/products.js";
import { errorBoundary as shopifyBoundary } from "../node_modules/@shopify/shopify-app-react-router/dist/esm/server/boundary/error.mjs";
import { CATALOGS } from "../app/locales/index.js";
import { createServer } from "vite";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
const { embeddedErrorBoundary, describeRouteError, ROOT_ERROR_KEYS } = await vite.ssrLoadModule("/app/lib/routeError.jsx");

console.log("\n── 1. Bandeau des commandes de test ──");
{
  const b = read("app/components/overview/Banners.jsx");
  ok(/DEV_TOGGLE_ACTION = "\/app\/overview"/.test(b) && /<fetcher\.Form method="post" action=\{DEV_TOGGLE_ACTION\}/.test(b) && !/<Form method="post">\s*<input type="hidden" name="intent" value="toggle_test_orders"/.test(b), "le bandeau envoie à l'action d'Aujourd'hui par un fetcher (plus à l'action de la page courante)");
  const hook = b.indexOf("const fetcher = useFetcher()"), early = b.indexOf("if (isDevShop !== true) return null");
  ok(hook > 0 && hook < early, "hook appelé avant le retour anticipé (règles des hooks)");
  ok(/intent === "toggle_test_orders"/.test(read("app/routes/app.overview.jsx")), "l'action d'Aujourd'hui traite toujours la bascule");
  const pages = readdirSync(new URL("../app/routes/", import.meta.url)).filter((f) => f.endsWith(".jsx") && /DevShopBanner/.test(read(`app/routes/${f}`)));
  ok(pages.sort().join(",") === "app.metrics.jsx,app.overview.jsx,app.products.jsx,app.simulator.jsx", `pages concernées, toutes couvertes par le même composant : ${pages.join(", ")}`);
}

console.log("\n── 2. Écran classique et erreurs ──");
{
  ok(!/data-legacy-link|cta_legacy/.test(read("app/components/overview/Blocks.jsx")), "D2-3 : l'état vide n'a plus de bouton vers l'écran classique (supprimé)");
  const raw = [];
  for (const dir of ["app/components", "app/routes"]) {
    const walk = (d) => { for (const e of readdirSync(new URL(`../${d}/`, import.meta.url), { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith(".jsx") && !p.endsWith("app._index.jsx") && /<a\b[^>]*\shref="\/app/.test(read(p))) raw.push(p); } };
    walk(dir);
  }
  ok(raw.length === 0, `aucun lien HTML brut vers /app… dans les composants et routes (hors écran classique protégé)${raw.length ? " : " + raw.join(", ") : ""}`);
  ok(/<s-link rel="home" href="\/app\/overview">/.test(read("app/routes/app.jsx")) && !/nav\.legacy/.test(read("app/routes/app.jsx")), "D2-3 : menu de l'admin sans « Écran classique », accueil = Aujourd'hui");
  // Réponse d'erreur telle que la produit le bundle minifié (nom de classe raccourci).
  const Xe = class { constructor(status, statusText, data) { this.status = status; this.statusText = statusText; this.internal = false; this.data = data; } };
  const bounce = new Xe(200, "", '\n <script data-api-key="k" src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>\n');
  let shopifyThrew = false; try { shopifyBoundary(bounce); } catch { shopifyThrew = true; }
  ok(shopifyThrew, "cause reproduite : boundary.error de Shopify ne reconnaît pas la réponse minifiée (nom « Xe ») et la relance");
  const el = embeddedErrorBoundary(bounce);
  ok(el?.props?.dangerouslySetInnerHTML?.__html?.includes("app-bridge.js"), "embeddedErrorBoundary la reconnaît (isRouteErrorResponse) et affiche la page de Shopify, comme prévu");
  let rethrown = false; try { embeddedErrorBoundary(new Error("boom")); } catch { rethrown = true; }
  ok(rethrown, "toute autre erreur remonte à la page d'erreur racine");
  const cases = [describeRouteError(new Xe(401, "Unauthorized", "")), describeRouteError(new Xe(404, "Not Found", "")), describeRouteError(new Xe(500, "", { a: 1 })), describeRouteError(new Error("Réseau")), describeRouteError({ weird: true }), describeRouteError(null)];
  ok(cases.map((c) => c.key).join(",") === "error.session,error.not_found,error.generic,error.generic,error.generic,error.generic", "messages : session expirée (401), page introuvable (404), sinon message générique");
  ok(cases.every((c) => !/\[object Object\]/.test(`${c.detail ?? ""}`)) && cases[2].detail === null && cases[3].detail === "Réseau", "détail technique : texte court ou rien, jamais un objet converti (« [object Object] »)");
  ok(ROOT_ERROR_KEYS.every((k) => CATALOGS.en[k] && CATALOGS.fr[k]) && CATALOGS.fr["error.session"].includes("Rouvrez l'app"), "page d'erreur traduite en/fr (clés error.*)");
  const root = read("app/root.jsx");
  ok(/export const loader = /.test(root) && /describeRouteError\(error\)/.test(root) && !/String\(error\)/.test(root) && /errorTexts/.test(root), "racine : loader des textes d'erreur (sans le catalogue complet), message lisible, plus de String(error)");
  const routes = readdirSync(new URL("../app/routes/", import.meta.url)).filter((f) => f.endsWith(".jsx") && /export function ErrorBoundary/.test(read(`app/routes/${f}`)));
  const shopifyLeft = routes.filter((f) => f !== "app._index.jsx" && /boundary\.error\(/.test(read(`app/routes/${f}`)));
  ok(shopifyLeft.length === 0 && routes.filter((f) => /embeddedErrorBoundary\(useRouteError\(\)\)/.test(read(`app/routes/${f}`))).length === 14, "14 routes sur embeddedErrorBoundary ; plus aucun boundary.error (hors écran classique protégé)");
}

console.log("\n── 3. Taux de retour de l'audit ──");
{
  const none = returnRateFromKpis([{ id: "return_rate", status: "insufficient", value: null, missing: { orders: 1 } }]);
  ok(none.returnRatePct === null && none.returnRateMissing === null && none.returnRateNoOrders === true, "aucune commande retenue : « aucune commande », pas « il manque 1 commande »");
  const few = returnRateFromKpis([{ id: "return_rate", status: "insufficient", value: null, missing: { orders_out_of_window: 47 } }]);
  ok(few.returnRateMissing === 47 && few.returnRateNoOrders === false, "3 commandes sorties de la fenêtre sur 50 : il en manque 47");
  ok(returnRateFromKpis([{ id: "return_rate", status: "ok", value: 4.26 }]).returnRatePct === 4.3, "mesurable : 4,3 %");
  ok(/il faut 50 commandes/.test(CATALOGS.fr["products.audit.return_rate_missing_other"]) && CATALOGS.fr["products.audit.return_rate_no_orders"] && CATALOGS.en["products.audit.return_rate_no_orders"], "messages : seuil de 50 rappelé ; « aucune commande » traduit");
  ok(read("package.json").includes("lot39_test_defects"), "lot 39 dans la chaîne de tests");
}

await vite.close();
console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 39 (défauts vus en boutique) : ✓ Tous les tests passent" : ` BILAN LOT 39 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
