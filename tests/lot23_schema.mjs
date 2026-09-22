// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Schéma F1 — modèle de données de la refonte (supabase/migrations/20260922_f1_*).
//  1. RLS : chaque table créée par F1 a ENABLE ROW LEVEL SECURITY + politique deny_public_access
//     (précédée de DROP POLICY IF EXISTS) dans le MÊME fichier.
//  2. Ré-exécutabilité : IF NOT EXISTS sur tables/index/colonnes, CREATE OR REPLACE sur fonctions.
//  3. Contrat de liste : app/lib/schema.js (ALL_TABLES) = tables créées par TOUTES les migrations.
//  4. Purge : purge_shop vide chaque table de PURGE_TABLES (et rien d'autre) ; les webhooks appellent
//     la RPC et ne portent plus AUCUN nom de table en dur (repli piloté par la liste partagée).
//  5. order_margins : clé d'idempotence intacte ; F1 n'ajoute que des colonnes NULLABLES sans
//     DEFAULT ; colonnes de snapshot = contrat de schema.js.
//  6. Chiffrement des jetons : aller-retour, clé absente/invalide → erreur, IV aléatoire.
//  7. redact_customer : forme vérifiée statiquement (E2E documenté après application).
//  Pour lancer : node tests/lot23_schema.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  ALL_TABLES, LEGACY_TABLES, F1_TABLES, PURGE_TABLES, SHARED_REFERENCE_TABLES,
  ORDER_MARGINS_KEY, ORDER_MARGINS_SNAPSHOT_COLUMNS, ORDER_EXCLUSION_REASONS,
} from "../app/lib/schema.js";
import { encryptSecret, decryptSecret } from "../app/lib/crypto.server.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const MIG_DIR = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const f1Files = files.filter((f) => f.startsWith("20260922_f1_"));
const read = (f) => readFileSync(new URL(f, MIG_DIR), "utf8");
const createdTables = (sql) => [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);

// ── 1. RLS + deny_public_access sur chaque table F1 ──
console.log("\n── 1. RLS deny-all sur chaque table créée par F1 ──");
{
  ok(f1Files.length === 24, `24 migrations F1 présentes (23 + addendum F3) (trouvées : ${f1Files.length})`);
  let tables = 0;
  for (const f of f1Files) {
    const sql = read(f);
    for (const t of createdTables(sql)) {
      tables++;
      const rls = new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql);
      const drop = new RegExp(`DROP POLICY IF EXISTS "deny_public_access" ON public\\.${t}`).test(sql);
      const pol = new RegExp(`CREATE POLICY "deny_public_access" ON public\\.${t}\\s*\\n?\\s*FOR ALL USING \\(false\\) WITH CHECK \\(false\\)`).test(sql);
      ok(rls && drop && pol, `${t} : RLS activée + DROP POLICY IF EXISTS + politique deny_public_access (${f})`);
    }
  }
  ok(tables === F1_TABLES.length, `${F1_TABLES.length} tables créées par F1 (trouvées : ${tables})`);
}

// ── 2. Ré-exécutabilité ──
console.log("\n── 2. Migrations F1 ré-exécutables ──");
{
  for (const f of f1Files) {
    const sql = read(f);
    const badTable = /CREATE TABLE\s+(?!IF NOT EXISTS)/i.test(sql);
    const badIndex = /CREATE INDEX\s+(?!IF NOT EXISTS)/i.test(sql);
    const badCol = /ADD COLUMN\s+(?!IF NOT EXISTS)/i.test(sql);
    const badFn = /CREATE FUNCTION/i.test(sql); // doit être CREATE OR REPLACE FUNCTION
    const badPolicy = (sql.match(/CREATE POLICY/g) ?? []).length !== (sql.match(/DROP POLICY IF EXISTS/g) ?? []).length;
    ok(!badTable && !badIndex && !badCol && !badFn && !badPolicy, `${f} : IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS partout`);
  }
}

// ── 3. Contrat de liste : schema.js = tables de toutes les migrations ──
console.log("\n── 3. schema.js = ensemble des tables créées par les migrations ──");
{
  const fromSql = new Set(files.flatMap((f) => createdTables(read(f))));
  const fromJs = new Set(ALL_TABLES);
  const missingInJs = [...fromSql].filter((t) => !fromJs.has(t));
  const missingInSql = [...fromJs].filter((t) => !fromSql.has(t));
  ok(missingInJs.length === 0, `aucune table SQL absente de schema.js${missingInJs.length ? " : " + missingInJs.join(", ") : ""}`);
  ok(missingInSql.length === 0, `aucune table de schema.js absente des migrations${missingInSql.length ? " : " + missingInSql.join(", ") : ""}`);
  ok(LEGACY_TABLES.length === 12 && F1_TABLES.length === 26, `12 tables historiques + 26 tables F1 (${LEGACY_TABLES.length} + ${F1_TABLES.length})`);
  ok(new Set(ALL_TABLES).size === ALL_TABLES.length, "aucun doublon dans ALL_TABLES");
  const f1Created = new Set(f1Files.flatMap((f) => createdTables(read(f))));
  ok(F1_TABLES.every((t) => f1Created.has(t)) && [...f1Created].every((t) => F1_TABLES.includes(t)), "F1_TABLES = exactement les tables des fichiers 20260922_f1_*");
}

// ── 4. Purge : purge_shop ↔ PURGE_TABLES ↔ webhooks ──
console.log("\n── 4. purge_shop = PURGE_TABLES ; webhooks sans liste en dur ──");
{
  const rgpd = read("20260922_f1_23_rgpd_functions.sql");
  const purgeBody = rgpd.slice(rgpd.indexOf("FUNCTION public.purge_shop"), rgpd.indexOf("FUNCTION public.redact_customer"));
  const deleted = [...purgeBody.matchAll(/DELETE FROM public\.(\w+)\s+WHERE shop_domain = p_shop/g)].map((m) => m[1]);
  const notPurged = PURGE_TABLES.filter((t) => !deleted.includes(t));
  const extra = deleted.filter((t) => !PURGE_TABLES.includes(t));
  ok(notPurged.length === 0, `chaque table de PURGE_TABLES est vidée par purge_shop${notPurged.length ? " — manquantes : " + notPurged.join(", ") : ""}`);
  ok(extra.length === 0, `purge_shop ne vide rien hors PURGE_TABLES${extra.length ? " — en trop : " + extra.join(", ") : ""}`);
  ok(new Set(deleted).size === deleted.length, "aucune table vidée deux fois");
  ok(SHARED_REFERENCE_TABLES.every((t) => !deleted.includes(t)), "fx_rates (référentiel partagé) hors purge");
  ok(deleted.indexOf("manual_commissions") < deleted.indexOf("partners") && deleted.indexOf("promo_code_rules") < deleted.indexOf("partners"), "enfants (commissions, codes) vidés avant partners (FK)");
  ok(deleted.indexOf("calculation_annotations") < deleted.indexOf("calculations"), "annotations vidées avant calculations (FK)");
  ok(PURGE_TABLES.length === ALL_TABLES.length - SHARED_REFERENCE_TABLES.length, "purge totale : toutes les tables sauf les référentiels partagés (décision g)");
  for (const w of ["../app/routes/webhooks.app.uninstalled.jsx", "../app/routes/webhooks.compliance.jsx"]) {
    const src = readFileSync(new URL(w, import.meta.url), "utf8");
    ok(src.includes('supabase.rpc("purge_shop", { p_shop: shop })'), `${w.split("/").pop()} : appelle la RPC purge_shop`);
    ok(!/\.from\("/.test(src), `${w.split("/").pop()} : aucun nom de table en dur (repli piloté par PURGE_TABLES)`);
    ok(src.includes("PURGE_TABLES"), `${w.split("/").pop()} : repli sur la liste partagée schema.js`);
  }
  const compliance = readFileSync(new URL("../app/routes/webhooks.compliance.jsx", import.meta.url), "utf8");
  ok(compliance.includes('supabase.rpc("redact_customer"') && compliance.includes("gid://shopify/Customer/"), "customers/redact : RPC redact_customer avec le gid brut (décision b)");
}

// ── 5. order_margins : clé intacte, colonnes F1 nullables sans DEFAULT, contrat snapshot ──
console.log("\n── 5. order_margins : contrat d'immuabilité ──");
{
  const base = read("20260622_order_margins.sql");
  ok(base.includes(`UNIQUE (${ORDER_MARGINS_KEY.join(", ")})`), `clé d'idempotence (${ORDER_MARGINS_KEY.join(", ")}) présente dans la migration d'origine`);
  const ext = read("20260922_f1_03_order_margins_extend.sql");
  const addedCols = [...ext.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)\s+([^,;]+)/g)].map((m) => ({ col: m[1], def: m[2] }));
  ok(addedCols.length === 8, `8 colonnes ajoutées à order_margins (trouvées : ${addedCols.length})`);
  ok(addedCols.every((c) => !/DEFAULT/i.test(c.def) && !/NOT NULL/i.test(c.def)), "aucune colonne ajoutée n'a de DEFAULT ni de NOT NULL (aucun snapshot réécrit)");
  ok(!/RENAME/i.test(ext) && !/DROP COLUMN/i.test(ext), "F1 ne renomme ni ne supprime rien sur order_margins (rename en F2 avec le code)");
  const snapshotAdded = ["unit_price_ht", "tax_lines", "cm1_components", "cm1_unit", "cm2_alloc"];
  ok(snapshotAdded.every((c) => ORDER_MARGINS_SNAPSHOT_COLUMNS.includes(c) && addedCols.some((a) => a.col === c)), "les nouvelles composantes CM1/CM2 sont déclarées colonnes de snapshot dans schema.js");
  for (const f of f1Files) {
    const sql = read(f);
    const rewrites = ORDER_MARGINS_SNAPSHOT_COLUMNS.some((c) => new RegExp(`UPDATE public\\.order_margins[\\s\\S]*SET[\\s\\S]*\\b${c}\\b`, "i").test(sql));
    ok(!rewrites, `${f} : aucun UPDATE d'une colonne de snapshot d'order_margins`);
  }
  const ordersSql = read("20260922_f1_02_orders.sql");
  ok(ORDER_EXCLUSION_REASONS.every((r) => ordersSql.includes(`'${r}'`)), "orders.excluded_reason : le CHECK SQL porte exactement les raisons de schema.js");
}

// ── 6. Chiffrement des jetons ──
console.log("\n── 6. Chiffrement AES-256-GCM des jetons ──");
{
  const key = randomBytes(32).toString("base64");
  const secret = "shpat_exemple_de_jeton_à_protéger_🔐";
  const enc1 = encryptSecret(secret, key);
  const enc2 = encryptSecret(secret, key);
  ok(decryptSecret(enc1, key) === secret, "aller-retour : déchiffré === original (UTF-8 conservé)");
  ok(enc1 !== enc2, "deux chiffrements du même jeton diffèrent (IV aléatoire)");
  ok(!enc1.includes("shpat_"), "le texte chiffré ne contient pas le jeton en clair");
  let threw = false; try { encryptSecret(secret, ""); } catch { threw = true; }
  ok(threw, "clé absente → erreur explicite (jamais de stockage en clair)");
  threw = false; try { encryptSecret(secret, randomBytes(16).toString("base64")); } catch { threw = true; }
  ok(threw, "clé de mauvaise longueur → erreur");
  threw = false; try { decryptSecret(enc1, randomBytes(32).toString("base64")); } catch { threw = true; }
  ok(threw, "mauvaise clé → échec d'authentification GCM (pas de texte corrompu rendu)");
}

// ── 7. redact_customer : forme statique ──
console.log("\n── 7. redact_customer ──");
{
  const rgpd = read("20260922_f1_23_rgpd_functions.sql");
  const body = rgpd.slice(rgpd.indexOf("FUNCTION public.redact_customer"));
  ok(/DELETE FROM public\.customers_agg WHERE shop_domain = p_shop AND customer_id = p_customer_id/.test(body), "supprime la ligne customers_agg du client");
  ok(/UPDATE public\.orders[\s\S]*SET customer_id = NULL, customer_order_index = NULL/.test(body), "anonymise les commandes du client (identifiant et rang à NULL)");
  ok(!/DELETE FROM public\.orders/.test(body), "ne supprime AUCUNE commande (les montants restent, non nominatifs)");
}

// ── 8. Rollback F1 : hors migrations/, défait exactement ce que F1 crée, idempotent ──
console.log("\n── 8. Rollback F1 (supabase/rollback) ──");
{
  const rb = readFileSync(new URL("../supabase/rollback/20260922_f1_rollback.sql", import.meta.url), "utf8");
  ok(!files.some((f) => f.includes("rollback")), "aucun fichier de rollback dans supabase/migrations (un db push ne l'appliquera jamais)");
  const dropped = [...rb.matchAll(/DROP TABLE IF EXISTS public\.(\w+)\s+CASCADE/g)].map((m) => m[1]);
  const notDropped = F1_TABLES.filter((t) => !dropped.includes(t));
  const extraDropped = dropped.filter((t) => !F1_TABLES.includes(t));
  ok(notDropped.length === 0, `chaque table F1 est supprimée par le rollback${notDropped.length ? " — manquantes : " + notDropped.join(", ") : ""}`);
  ok(extraDropped.length === 0, `le rollback ne supprime AUCUNE table historique${extraDropped.length ? " — en trop : " + extraDropped.join(", ") : ""}`);
  ok(dropped.indexOf("manual_commissions") < dropped.indexOf("partners") && dropped.indexOf("promo_code_rules") < dropped.indexOf("partners"), "enfants supprimés avant partners");
  ok(/DROP FUNCTION IF EXISTS public\.purge_shop\(TEXT\)/.test(rb) && /DROP FUNCTION IF EXISTS public\.redact_customer\(TEXT, TEXT\)/.test(rb), "les deux fonctions RGPD sont retirées");
  const ext = read("20260922_f1_03_order_margins_extend.sql");
  const omAdded = [...ext.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  const omDropped = [...rb.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)].map((m) => m[1]);
  ok(omAdded.every((c) => omDropped.includes(c)), "les 8 colonnes ajoutées à order_margins sont retirées");
  const vcExt = read("20260922_f1_13_variant_costs_extend.sql");
  const vcAdded = [...vcExt.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  ok(vcAdded.every((c) => omDropped.includes(c)), "les 4 colonnes ajoutées à variant_costs sont retirées");
  const addendum = read("20260922_f1_24_addendum_f3.sql");
  const addAdded = [...addendum.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  ok(addAdded.length === 4 && addAdded.every((c) => omDropped.includes(c)), "les 4 colonnes de l'addendum F3 (shop_settings) sont retirées par le rollback");
  ok(!/CREATE TABLE/i.test(addendum) && /ALTER TABLE public\.shop_settings/.test(addendum), "addendum F3 : uniquement des colonnes sur shop_settings (aucune table nouvelle)");
  const f1Indexes = f1Files.flatMap((f) => [...read(f).matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON public\.(order_margins|variant_costs)/g)].map((m) => m[1]));
  ok(f1Indexes.every((i) => rb.includes(`DROP INDEX IF EXISTS public.${i}`)), "les index F1 posés sur les tables historiques sont retirés");
  ok(!/DROP COLUMN IF EXISTS shipping_model/.test(rb) && /shipping_model n'est PAS retirée/.test(rb), "shop_plans.shipping_model conservée (pré-existante en prod) et documentée");
  ok((rb.match(/DROP (TABLE|FUNCTION|COLUMN|INDEX)(?! IF EXISTS)/g) ?? []).length === 0, "rollback idempotent : IF EXISTS sur chaque DROP");
  ok(!/DELETE FROM|TRUNCATE|UPDATE /.test(rb), "le rollback ne touche à AUCUNE donnée des tables historiques");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 23 (schéma F1) : ✓ Tous les tests passent"
  : ` BILAN LOT 23 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
