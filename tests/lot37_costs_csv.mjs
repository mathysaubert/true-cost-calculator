// ════════════════════════════════════════════════════════════════════════════════
//  LOT 37 — Coûts produits : le fichier exporté se réimporte tel quel (test boutique 7, 2026-09-26).
//  Règle « vide = non renseigné, 0 saisi = vrai 0 » ; lignes à coût vide « à compléter » (pas des
//  erreurs) ; rejets avec raison ; fichiers réenregistrés par Excel (« ; », décimale « , »,
//  UTF-8 avec BOM ou Windows-1252). L'écran classique garde ses fonctions, inchangées.
//  Pour lancer : node tests/lot37_costs_csv.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { buildCostRowsForDisplay, parseCostsCsv, buildCostsCsv } from "../app/lib/variantCosts.js";
import { costsCsvTemplate, parseCostsCsvStrict, decodeCsvBytes, detectSeparator, validateCostFields, CSV_TEMPLATE_COLUMNS, SUGGESTION_COLUMN } from "../app/lib/costsCsv.js";
import { CATALOGS } from "../app/locales/index.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const gid = (n) => `gid://shopify/ProductVariant/${n}`;

// Boutique de dev reconstituée : 8 variantes renseignées par le marchand, 16 sans coût saisi
// (8 avec un coût Shopify, 8 sans — les snowboards et le poster).
const variants = [], stored = new Map();
for (let i = 1; i <= 24; i++) {
  variants.push({ variant_id: gid(i), product_id: `gid://shopify/Product/${Math.ceil(i / 3)}`, product_title: i > 16 ? `Snowboard ${i}` : `Produit ${i}`, variant_title: "Default", price: 50, unitCost: i > 8 && i <= 16 ? "12.5" : null, categoryName: i % 2 ? "Electronics" : "Apparel" });
  if (i <= 8) stored.set(gid(i), { variant_id: gid(i), prix_achat: i === 8 ? 0 : 20 + i, port_entrant: 0, qty_par_lot: 1, cout_emballage: 0.3, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: i % 2 ? "Électronique" : "Textile", source: i % 2 ? "confirmed" : "imported" });
}
const rows = buildCostRowsForDisplay({ variants, storedMap: stored, defaultCountry: "Chine", vatRegime: "assujetti", shippingModel: "stock" });

console.log("\n── 1. Cause reproduite (ancien modèle) ──");
{
  const old = buildCostsCsv(rows);
  const oldParsed = parseCostsCsv(old);
  ok(oldParsed.rows.length === 15 && oldParsed.errors.length === 9, `ancien modèle réimporté : ${oldParsed.rows.length} importées dont 8 suggestions Shopify devenues « importées », ${oldParsed.errors.length} rejetées (coût non renseigné écrit 0, et le vrai 0 de la variante 8)`);
}

console.log("\n── 2. Nouveau modèle ──");
{
  const csv = costsCsvTemplate(rows);
  const lines = csv.split("\r\n");
  ok(lines[0] === CSV_TEMPLATE_COLUMNS.join(",") && lines.length === 25, "en-tête + 24 variantes ; colonne suggestion_prix_achat en dernier");
  const byId = Object.fromEntries(lines.slice(1).map((l) => [l.split(",")[0], l.split(",")]));
  const col = (name) => CSV_TEMPLATE_COLUMNS.indexOf(name);
  ok(byId[gid(1)][col("prix_achat")] === "21" && byId[gid(8)][col("prix_achat")] === "0", "coûts saisis exportés tels quels, vrai 0 compris");
  ok([gid(9), gid(20)].every((id) => byId[id][col("prix_achat")] === "" && byId[id][col("port_entrant")] === "" && byId[id][col("cout_emballage")] === "" && byId[id][col("qty_par_lot")] === ""), "variante sans coût saisi : coûts VIDES (jamais la suggestion, jamais 0)");
  ok(byId[gid(9)][col(SUGGESTION_COLUMN)] === "12.5" && byId[gid(20)][col(SUGGESTION_COLUMN)] === "" && byId[gid(1)][col(SUGGESTION_COLUMN)] === "", "coût Shopify donné à part (suggestion) ; rien si inconnu ou si le marchand a saisi");
  const back = parseCostsCsvStrict(csv);
  ok(back.rows.length === 8 && back.incomplete.length === 16 && back.errors.length === 0 && !back.header, "réimport du fichier tel quel : 8 importées, 16 à compléter, 0 rejet");
  ok(back.rows.find((r) => r.variant_id === gid(8)).value.prix_achat === 0 && !back.rows.some((r) => Number(r.variant_id.split("/").pop()) > 8), "le vrai 0 est accepté ; aucune suggestion Shopify importée comme coût du marchand");
  ok(back.incomplete.find((r) => r.variant_id === gid(20)).empty.join(",") === "prix_achat,port_entrant,cout_emballage", "à compléter : les champs vides sont nommés (quantité vide = 1)");
}

console.log("\n── 3. Rejets avec raison ──");
{
  const head = CSV_TEMPLATE_COLUMNS.join(",");
  const p = parseCostsCsvStrict(`${head}\n${gid(1)},T,D,abc,-2,1.5,0,assujetti,stock,Chine,Electro,\n,T,D,1,0,1,0,assujetti,stock,Chine,Autre,\n123,T,D,1,0,1,0,assujetti,stock,Chine,Autre,`);
  const iss = (line) => p.errors.find((e) => e.line === line)?.issues ?? [];
  ok(iss(2).map((x) => `${x.field}:${x.reason}`).join(",") === "prix_achat:not_number,port_entrant:negative,qty_par_lot:not_integer,categorie:unknown_value", "ligne 2 : chaque champ refusé porte sa raison");
  ok(iss(2)[0].value === "abc" && iss(2).find((x) => x.field === "categorie").expected.includes("Électronique"), "valeur reçue et valeurs acceptées transmises");
  ok(iss(3)[0].reason === "missing_id" && iss(4)[0].reason === "bad_id", "identifiant manquant ; identifiant qui n'est pas une variante Shopify");
  ok(validateCostFields({ prix_achat: "1 234,5", port_entrant: "0", qty_par_lot: 2, cout_emballage: "0", vat_regime: "ASSUJETTI", shipping_model: "Stock", pays_import: "chine", categorie: "electronique" }).value?.categorie === "Électronique", "tolérant : espaces et virgule décimale, casse et accents des listes");
  ok(parseCostsCsvStrict("variant_id,prix_achat\nx,1").header?.reason === "missing_columns" && parseCostsCsvStrict("").header?.reason === "empty_file", "en-tête incomplet ou fichier vide : signalés");
}

console.log("\n── 4. Fichier réenregistré par Excel ──");
{
  const csv = costsCsvTemplate(rows);
  const semi = csv.split("\r\n").map((l, i) => (i === 0 ? l.replaceAll(",", ";") : l.replaceAll(",", ";").replace(/;(\d+)\.(\d+)(?=;)/g, ";$1,$2"))).join("\r\n");
  ok(detectSeparator(semi) === ";" && detectSeparator(csv) === ",", "séparateur détecté : « ; » (Excel FR) ou « , »");
  const pSemi = parseCostsCsvStrict(semi);
  ok(pSemi.rows.length === 8 && pSemi.incomplete.length === 16 && pSemi.errors.length === 0 && pSemi.rows.find((r) => r.variant_id === gid(1)).value.cout_emballage === 0.3, "« ; » et décimale « , » : même résultat (8 / 16 / 0)");
  const cp1252 = Uint8Array.from([...semi].map((c) => (c === "É" ? 0xc9 : c.charCodeAt(0) & 0xff)));
  const pWin = parseCostsCsvStrict(decodeCsvBytes(cp1252));
  ok(pWin.errors.length === 0 && pWin.rows.find((r) => r.variant_id === gid(1)).value.categorie === "Électronique", "Windows-1252 (CSV point-virgule d'Excel) : « Électronique » relu correctement");
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]);
  ok(parseCostsCsvStrict(decodeCsvBytes(bom)).rows.length === 8, "UTF-8 avec BOM (CSV UTF-8 d'Excel) : accepté");
}

console.log("\n── 5. Écran classique inchangé, branchements, catalogues ──");
{
  ok(parseCostsCsv(`variant_id,prix_achat,port_entrant,qty_par_lot,cout_emballage,vat_regime,shipping_model,pays_import,categorie\n${gid(1)},0,0,1,0,assujetti,stock,Chine,Autre`).errors.length === 1, "écran classique (protégé jusqu'à D2) : ses fonctions refusent toujours le prix 0 (son panneau remplit les vides par la suggestion)");
  const srv = read("app/lib/productCosts.server.js");
  ok(/costsCsvTemplate\(rows, \{ bom: true \}\)/.test(srv) && /parseCostsCsvStrict\(text/.test(srv) && !/buildCostsCsv|parseCostsCsv\(/.test(srv), "Réglages : modèle et import stricts ; plus d'appel aux fonctions de l'écran classique");
  ok(/decodeCsvBytes\(u8\)/.test(srv) && /importCostsFile\(\{ supabase, shop, bytes \}\)/.test(read("app/routes/app.settings.products.jsx")), "route : octets transmis, décodés côté serveur (UTF-8 ou Windows-1252)");
  const reasons = ["not_number", "negative", "not_integer", "below_one", "too_large", "unknown_value", "missing_id", "bad_id"];
  ok(reasons.every((r) => CATALOGS.fr[`productcosts.csv.reason.${r}`] && CATALOGS.en[`productcosts.csv.reason.${r}`]) && CATALOGS.fr["productcosts.csv.incomplete_other"], "raisons et message « à compléter » traduits en/fr");
  ok(read("package.json").includes("lot37_costs_csv"), "lot 37 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 37 (CSV des coûts produits) : ✓ Tous les tests passent" : ` BILAN LOT 37 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
