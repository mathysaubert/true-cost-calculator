// ════════════════════════════════════════════════════════════════════════════════
//  LOT 38 — Coûts produits : modèle Excel (.xlsx) en principal, CSV UTF-8 en second (2026-09-26).
//  Aller-retour .xlsx (même résultat que le CSV : importées / à compléter / 0 rejet), feuille
//  « Valeurs acceptées », fichier retouché (nombres saisis en texte), signatures (.xlsx, ancien .xls),
//  taille bornée, CSV téléchargé avec marque d'encodage, branchements.
//  Pour lancer : node tests/lot38_costs_xlsx.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import writeExcelFile from "write-excel-file/node";
import readXlsxFile from "read-excel-file/node";
import { buildCostRowsForDisplay } from "../app/lib/variantCosts.js";
import { buildCostsXlsx, readCostsXlsx, isXlsx, isLegacyXls, XLSX_MAX_BYTES } from "../app/lib/costsXlsx.server.js";
import { parseCostRows, costsCsvTemplate, CSV_TEMPLATE_COLUMNS, CSV_ENUM_FIELDS } from "../app/lib/costsCsv.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const gid = (n) => `gid://shopify/ProductVariant/${n}`;

const variants = [], stored = new Map();
for (let i = 1; i <= 24; i++) {
  variants.push({ variant_id: gid(i), product_id: `gid://shopify/Product/${i}`, product_title: i > 16 ? `Snowboard ${i}` : `Tee été ${i}`, variant_title: "Default", price: 50, unitCost: i > 8 && i <= 16 ? "12.5" : null, categoryName: "Apparel" });
  if (i <= 8) stored.set(gid(i), { variant_id: gid(i), prix_achat: i === 8 ? 0 : 20 + i + 0.5, port_entrant: 0, qty_par_lot: 1, cout_emballage: 0.3, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: i % 2 ? "Électronique" : "Textile", source: "confirmed" });
}
const rows = buildCostRowsForDisplay({ variants, storedMap: stored, defaultCountry: "Chine", vatRegime: "assujetti", shippingModel: "stock" });

console.log("\n── 1. Modèle .xlsx ──");
const buf = await buildCostsXlsx(rows, { costs: "Coûts", values: "Valeurs acceptées" });
const u8 = new Uint8Array(buf);
{
  ok(isXlsx(u8) && !isLegacyXls(u8), `fichier .xlsx valide (signature zip), ${buf.length} octets`);
  const sheets = await readXlsxFile(buf);
  ok(sheets.map((s) => s.sheet).join("|") === "Coûts|Valeurs acceptées", "deux feuilles : « Coûts » puis « Valeurs acceptées » (noms traduits)");
  const costs = sheets[0].data, head = costs[0];
  ok(head.join(",") === CSV_TEMPLATE_COLUMNS.join(",") && costs.length === 25, "feuille Coûts : mêmes colonnes que le CSV, 24 variantes");
  const row = (id) => costs.find((r) => r[0] === gid(id)), col = (c) => head.indexOf(c);
  ok(row(1)[col("prix_achat")] === 21.5 && typeof row(1)[col("prix_achat")] === "number" && row(8)[col("prix_achat")] === 0, "coûts saisis en nombres typés (21,5), vrai 0 conservé");
  ok(row(20)[col("prix_achat")] == null && row(9)[col("prix_achat")] == null && row(9)[col("suggestion_prix_achat")] === 12.5, "non renseigné = cellule vide ; suggestion Shopify dans sa colonne");
  ok(row(1)[col("categorie")] === "Électronique" && row(1)[col("product_title")] === "Tee été 1", "accents intacts (catégorie, titre)");
  const values = sheets[1].data;
  ok(values[0].join(",") === Object.keys(CSV_ENUM_FIELDS).join(",") && values.some((r) => r.includes("Électronique")) && values.some((r) => r.includes("franchise")), "Valeurs acceptées : TVA, expédition, pays, catégories");
}

console.log("\n── 2. Aller-retour et fichier retouché ──");
{
  const back = parseCostRows(await readCostsXlsx(u8));
  ok(back.rows.length === 8 && back.incomplete.length === 16 && back.errors.length === 0 && !back.header, "réimport du .xlsx tel quel : 8 importées, 16 à compléter, 0 rejet (comme le CSV)");
  ok(back.rows.find((r) => r.variant_id === gid(1)).value.prix_achat === 21.5 && back.rows.find((r) => r.variant_id === gid(8)).value.prix_achat === 0, "valeurs relues exactes, vrai 0 compris");
  // Tableur qui réenregistre les nombres en texte, avec virgule décimale, et complète une ligne.
  const edited = [CSV_TEMPLATE_COLUMNS.map((c) => ({ value: c })),
    [gid(9), "Tee", "Default", "12,40", "0", "", "0", "assujetti", "stock", "Chine", "textile", ""].map((v) => (v === "" ? null : { value: v, type: String })),
    [gid(20), "Snowboard", "Default", "abc", "", "", "", "assujetti", "stock", "Chine", "Sport", ""].map((v) => (v === "" ? null : { value: v, type: String }))];
  const p = parseCostRows(await readCostsXlsx(new Uint8Array(await writeExcelFile(edited).toBuffer())));
  ok(p.rows.length === 1 && p.rows[0].value.prix_achat === 12.4 && p.rows[0].value.categorie === "Textile" && p.rows[0].value.qty_par_lot === 1, "nombre saisi en texte « 12,40 », catégorie en minuscules, quantité vide : accepté (12,4, Textile, 1)");
  ok(p.incomplete.length === 1 && p.incomplete[0].variant_id === gid(20), "ligne avec coûts vides : à compléter, même si le prix est illisible (non renseigné prime)");
}

console.log("\n── 3. Formats et bornes ──");
{
  ok(isLegacyXls(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])) && !isXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])), "ancien .xls reconnu (non pris en charge, signalé)");
  ok(!isXlsx(new TextEncoder().encode("variant_id,prix_achat\n")) && XLSX_MAX_BYTES === 5 * 1024 * 1024, "un CSV n'est pas pris pour un .xlsx ; taille bornée à 5 Mo");
  let threw = false; try { await readCostsXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])); } catch { threw = true; }
  ok(threw, "zip illisible : erreur levée (l'import la traduit en « fichier illisible »)");
  const csv = costsCsvTemplate(rows, { bom: true });
  ok(csv.charCodeAt(0) === 0xfeff && costsCsvTemplate(rows).charCodeAt(0) !== 0xfeff, "CSV téléchargé : marque d'encodage UTF-8 (accents dans Excel) ; sans marque pour les usages internes");
}

console.log("\n── 4. Branchements ──");
{
  const srv = read("app/lib/productCosts.server.js");
  ok(/export async function exportCosts/.test(srv) && /buildCostsXlsx\(rows, sheetNames\)/.test(srv) && /export async function importCostsFile/.test(srv) && /isXlsx\(u8\)/.test(srv) && /isLegacyXls\(u8\)/.test(srv) && /XLSX_MAX_BYTES/.test(srv), "serveur : export .xlsx / CSV, import .xlsx ou .csv, formats et taille contrôlés");
  const route = read("app/routes/app.settings.products_.export.jsx");
  ok(/authenticate\.admin\(request\)/.test(route) && /Content-Disposition/.test(route) && /=== "csv" \? "csv" : "xlsx"/.test(route), "route de téléchargement authentifiée, .xlsx par défaut");
  const ui = read("app/components/settings/ProductCosts.jsx");
  ok(/fetch\(`\$\{EXPORT_PATH\}\?format=\$\{format\}`\)/.test(ui) && /URL\.createObjectURL/.test(ui) && !/data:text\/csv/.test(ui) && /accept="\.xlsx,\.csv/.test(ui), "page : téléchargement par fetch (jeton App Bridge), plus de lien data: ; import .xlsx accepté");
  const pkg = read("package.json");
  ok(/"write-excel-file"/.test(pkg) && /"read-excel-file"/.test(pkg) && pkg.includes("lot38_costs_xlsx"), "dépendances déclarées ; lot 38 dans la chaîne de tests");
  ok(!/write-excel-file|read-excel-file/.test(read("app/components/settings/ProductCosts.jsx")), "bibliothèques jamais importées côté navigateur");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 38 (modèle Excel des coûts produits) : ✓ Tous les tests passent" : ` BILAN LOT 38 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
