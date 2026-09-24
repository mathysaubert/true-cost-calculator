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
  ALL_TABLES, LEGACY_TABLES, F1_TABLES, I0_TABLES, PURGE_TABLES, SHARED_REFERENCE_TABLES,
  ORDER_MARGINS_KEY, ORDER_MARGINS_SNAPSHOT_COLUMNS, ORDER_EXCLUSION_REASONS, DECISION_KINDS,
} from "../app/lib/schema.js";
import { encryptSecret, decryptSecret } from "../app/lib/crypto.server.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

const MIG_DIR = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
const f1Files = files.filter((f) => f.startsWith("20260922_f1_"));
const read = (f) => readFileSync(new URL(f, MIG_DIR), "utf8");
const createdTables = (sql) => [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?(\w+)/gi)].map((m) => m[1]);
const i0Files = files.filter((f) => f.startsWith("20260924_i0_"));
// purge_shop est redéfinie (CREATE OR REPLACE) par les migrations qui ajoutent des tables : la
// définition EFFECTIVE est la dernière dans l'ordre alphabétique des fichiers.
const purgeDeletes = (sql) => { const b = sql.slice(sql.indexOf("FUNCTION public.purge_shop")); const end = b.indexOf("$$;"); return [...b.slice(0, end).matchAll(/DELETE FROM public\.(\w+)\s+WHERE shop_domain = p_shop/g)].map((m) => m[1]); };
const purgeFiles = files.filter((f) => read(f).includes("FUNCTION public.purge_shop"));
const latestPurgeFile = purgeFiles[purgeFiles.length - 1];
const f1Deleted = purgeDeletes(read("20260922_f1_23_rgpd_functions.sql"));

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
  ok(LEGACY_TABLES.length === 12 && F1_TABLES.length === 26 && I0_TABLES.length === 2, `12 tables historiques + 26 tables F1 + 2 tables I0 (${LEGACY_TABLES.length} + ${F1_TABLES.length} + ${I0_TABLES.length})`);
  ok(new Set(ALL_TABLES).size === ALL_TABLES.length, "aucun doublon dans ALL_TABLES");
  const f1Created = new Set(f1Files.flatMap((f) => createdTables(read(f))));
  ok(F1_TABLES.every((t) => f1Created.has(t)) && [...f1Created].every((t) => F1_TABLES.includes(t)), "F1_TABLES = exactement les tables des fichiers 20260922_f1_*");
}

// ── 4. Purge : purge_shop ↔ PURGE_TABLES ↔ webhooks ──
console.log("\n── 4. purge_shop = PURGE_TABLES ; webhooks sans liste en dur ──");
{
  const deleted = purgeDeletes(read(latestPurgeFile));
  ok(latestPurgeFile === "20260924_i0_01_decision_memory.sql", `définition effective de purge_shop = dernier fichier qui la redéfinit (${latestPurgeFile})`);
  ok(f1Deleted.every((t, i) => deleted[i] === t), "la liste F1-23 est un préfixe exact de la définition effective (ordre conservé)");
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

// ── 9. Addendum F4 (C6a) : deux colonnes sur shop_settings, défaut neutre, retirées par le rollback ──
console.log("\n── 9. Addendum F4-01 (réglage boutique de développement) ──");
{
  const f4 = read("20260923_f4_01_dev_shop_settings.sql");
  const rb = readFileSync(new URL("../supabase/rollback/20260922_f1_rollback.sql", import.meta.url), "utf8");
  const added = [...f4.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)\s+([^,;]+)/g)].map((m) => ({ col: m[1], def: m[2] }));
  ok(added.length === 2 && added.some((c) => c.col === "is_dev_shop") && added.some((c) => c.col === "include_test_orders"), `2 colonnes (is_dev_shop, include_test_orders) — trouvées : ${added.map((c) => c.col).join(", ")}`);
  ok(!/CREATE TABLE/i.test(f4) && /ALTER TABLE public\.shop_settings/.test(f4) && !/UPDATE |DELETE FROM/i.test(f4), "addendum F4 : uniquement des colonnes sur shop_settings, aucune donnée touchée");
  const inc = added.find((c) => c.col === "include_test_orders");
  ok(inc && /DEFAULT false/i.test(inc.def), "include_test_orders : défaut false (jamais actif par défaut)");
  const dev = added.find((c) => c.col === "is_dev_shop");
  ok(dev && !/DEFAULT/i.test(dev.def) && !/NOT NULL/i.test(dev.def), "is_dev_shop : nullable sans défaut (NULL = pas encore lu)");
  const dropped = [...rb.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)].map((m) => m[1]);
  ok(added.every((c) => dropped.includes(c.col)), "les 2 colonnes de l'addendum F4 sont retirées par le rollback");
}

// ── 10. I0-01 : mémoire des décisions (2 tables, RLS, fonction, purge étendue, rollback dédié) ──
console.log("\n── 10. I0-01 mémoire des décisions ──");
{
  ok(i0Files.length === 1 && i0Files[0] === "20260924_i0_01_decision_memory.sql", `1 migration I0 (${i0Files.join(", ")})`);
  const sql = read(i0Files[0]);
  const created = createdTables(sql);
  ok(created.join(",") === I0_TABLES.join(","), `I0_TABLES = tables créées par la migration I0 (${created.join(", ")})`);
  for (const t of created) {
    const rls = new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql);
    const drop = new RegExp(`DROP POLICY IF EXISTS "deny_public_access" ON public\\.${t}`).test(sql);
    const pol = new RegExp(`CREATE POLICY "deny_public_access" ON public\\.${t}\\s*\\n?\\s*FOR ALL USING \\(false\\) WITH CHECK \\(false\\)`).test(sql);
    ok(rls && drop && pol, `${t} : RLS activée + DROP POLICY IF EXISTS + politique deny_public_access`);
  }
  ok(!/CREATE TABLE\s+(?!IF NOT EXISTS)/i.test(sql) && !/CREATE INDEX\s+(?!IF NOT EXISTS)/i.test(sql) && !/CREATE FUNCTION/i.test(sql) && (sql.match(/CREATE POLICY/g) ?? []).length === (sql.match(/DROP POLICY IF EXISTS/g) ?? []).length, "I0-01 ré-exécutable : IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS partout");
  ok(!/UPDATE public\.|DELETE FROM public\.(?!\w+\s+WHERE shop_domain = p_shop)|ALTER TABLE public\.(?!insight_log|decision_log)/.test(sql), "I0-01 ne touche à aucune donnée ni table existante (hors purge_shop)");
  const check = sql.match(/kind\s+TEXT\s+NOT NULL CHECK \(kind IN \(([^)]*)\)\)/);
  const kinds = check ? [...check[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
  ok(kinds.join(",") === DECISION_KINDS.join(","), `decision_log.kind : CHECK SQL = DECISION_KINDS (${kinds.join(", ")})`);
  ok(/CREATE OR REPLACE FUNCTION public\.record_insights\(p_shop TEXT, p_rows JSONB\)/.test(sql) && /ON CONFLICT \(shop_domain, fingerprint\) DO UPDATE/.test(sql) && /shown_count\s+=\s+public\.insight_log\.shown_count \+ 1/.test(sql) && /resolved_at\s+=\s+NULL/.test(sql), "record_insights : upsert par empreinte, shown_count + 1, resolved_at effacé au réaffichage");
  ok(/PRIMARY KEY \(shop_domain, fingerprint\)/.test(sql) && /idx_insight_log_shop_rule_window/.test(sql) && /idx_decision_log_shop_decided/.test(sql), "clé (shop_domain, fingerprint) + index règle/fenêtre et décisions récentes");
  ok(!/customer|email|first_name|address/i.test(sql.slice(0, sql.indexOf("CREATE OR REPLACE FUNCTION"))), "aucune colonne nominative dans les deux tables");
  const rb = readFileSync(new URL("../supabase/rollback/20260924_i0_rollback.sql", import.meta.url), "utf8");
  const dropped = [...rb.matchAll(/DROP TABLE IF EXISTS public\.(\w+)\s+CASCADE/g)].map((m) => m[1]);
  ok(dropped.length === I0_TABLES.length && I0_TABLES.every((t) => dropped.includes(t)), "rollback I0 : supprime exactement les 2 tables I0");
  ok(/DROP FUNCTION IF EXISTS public\.record_insights\(TEXT, JSONB\)/.test(rb), "rollback I0 : retire record_insights");
  ok(purgeDeletes(rb).join(",") === f1Deleted.join(","), "rollback I0 : purge_shop rétablie à l'identique de F1-23");
  ok((rb.match(/DROP (TABLE|FUNCTION|COLUMN|INDEX)(?! IF EXISTS)/g) ?? []).length === 0 && !/DELETE FROM public\.(?!\w+\s+WHERE shop_domain = p_shop)|TRUNCATE|UPDATE /.test(rb), "rollback I0 idempotent, aucune donnée touchée");
  ok(!files.some((f) => f.includes("rollback")), "aucun rollback dans supabase/migrations");
  const f1rb = readFileSync(new URL("../supabase/rollback/20260922_f1_rollback.sql", import.meta.url), "utf8");
  ok(!/insight_log|decision_log/.test(f1rb), "le rollback F1 ignore les tables I0 (rollback I0 à exécuter avant)");
}

// ── 11. R0 : colonnes Réglages (S-01) et trigger de recopie shop_plans → shop_settings (S-02) ──
console.log("\n── 11. R0 (Réglages : colonnes S-01, trigger de recopie S-02) ──");
{
  const r0Files = files.filter((f) => f.startsWith("20260924_r0_"));
  ok(r0Files.join(",") === "20260924_r0_01_settings_columns.sql,20260924_r0_02_shop_plans_sync_trigger.sql", `2 migrations R0 (${r0Files.join(", ")})`);
  const s01 = read("20260924_r0_01_settings_columns.sql"), s02 = read("20260924_r0_02_shop_plans_sync_trigger.sql");
  const added = [...s01.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)\s+([^,;]+)/g)].map((m) => ({ col: m[1], def: m[2] }));
  const R0_COLUMNS = ["main_product_price", "sales_countries", "shipping_countries", "supply_countries", "report_locale"];
  ok(added.map((c) => c.col).join(",") === R0_COLUMNS.join(","), `S-01 : 5 colonnes (${added.map((c) => c.col).join(", ")})`);
  ok(added.every((c) => !/DEFAULT/i.test(c.def) && !/NOT NULL/i.test(c.def)), "S-01 : toutes nullables sans défaut (S6 : rien de pré-rempli)");
  ok(!/CREATE TABLE/i.test(s01) && /ALTER TABLE public\.shop_settings/.test(s01) && !/UPDATE |DELETE FROM|DROP /i.test(s01), "S-01 : uniquement des colonnes sur shop_settings, aucune donnée touchée");
  ok(/CREATE OR REPLACE FUNCTION public\.sync_shop_plans_to_settings\(\)/.test(s02) && /RETURNS trigger/.test(s02) && /DROP TRIGGER IF EXISTS trg_shop_plans_sync_settings ON public\.shop_plans/.test(s02) && /CREATE TRIGGER trg_shop_plans_sync_settings/.test(s02), "S-02 : fonction OR REPLACE + DROP TRIGGER IF EXISTS + CREATE TRIGGER");
  const cols = s02.match(/AFTER INSERT OR UPDATE OF([\s\S]*?)ON public\.shop_plans/)?.[1] ?? "";
  ok(!/\bplan\b/.test(cols) && /vat_regime/.test(cols) && /profitability_threshold_pct/.test(cols) && /current_cpa_updated_at/.test(cols), "S-02 : le trigger écoute les colonnes de réglage, jamais la colonne plan (facturation)");
  ok(/ON CONFLICT \(shop_domain\) DO UPDATE/.test(s02) && /IS DISTINCT FROM/.test(s02) && !/DELETE FROM/i.test(s02), "S-02 : upsert sans écriture inutile (IS DISTINCT FROM), aucune suppression");
  const f1Copy = read("20260922_f1_01_shop_settings.sql");
  const f1Cols = f1Copy.match(/INSERT INTO public\.shop_settings \(([\s\S]*?)\)/)?.[1].replace(/\s/g, "").split(",") ?? [];
  const s02Cols = s02.match(/INSERT INTO public\.shop_settings \(([\s\S]*?)\)/)?.[1].replace(/\s/g, "").split(",") ?? [];
  ok(f1Cols.length > 0 && f1Cols.join(",") === s02Cols.join(","), "S-02 recopie exactement les colonnes que F1-01 a copiées");
  const spAdded = [...s02.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  ok(/ALTER TABLE public\.shop_plans/.test(s02) && spAdded.join(",") === "shopify_fee_pct,processor_fee_pct,processor_fixed_fee,default_import_country" && !/ALTER TABLE public\.shop_settings/.test(s02), "S-02 documente les 4 colonnes manuelles de shop_plans (idempotent), ne touche pas shop_settings");
  const rb = readFileSync(new URL("../supabase/rollback/20260924_r0_rollback.sql", import.meta.url), "utf8");
  const dropped = [...rb.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)].map((m) => m[1]);
  ok(dropped.join(",") === R0_COLUMNS.join(","), "rollback R0 : retire exactement les 5 colonnes S-01");
  ok(/DROP TRIGGER IF EXISTS trg_shop_plans_sync_settings ON public\.shop_plans/.test(rb) && /DROP FUNCTION IF EXISTS public\.sync_shop_plans_to_settings\(\)/.test(rb), "rollback R0 : retire le trigger et la fonction");
  ok(!/ALTER TABLE (IF EXISTS )?public\.shop_plans/.test(rb) && /ne sont PAS retirées/.test(rb), "rollback R0 : ne retire aucune colonne de shop_plans (pré-existantes en prod) et le documente");
  ok((rb.match(/DROP (TABLE|FUNCTION|COLUMN|INDEX|TRIGGER)(?! IF EXISTS)/g) ?? []).length === 0 && !/DELETE FROM|TRUNCATE|UPDATE /.test(rb), "rollback R0 idempotent, aucune donnée touchée");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 23 (schéma F1) : ✓ Tous les tests passent"
  : ` BILAN LOT 23 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
