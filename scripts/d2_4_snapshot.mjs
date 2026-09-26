// Usage : LABEL=<nom> OUT=<fichier.json> node --env-file=<.env.test|.env> scripts/d2_4_snapshot.mjs
// LECTURE SEULE — empreinte des objets touchés par D2-4 (structure + données), pour prouver le retour arrière.
// Base visée : DIRECT_URL du fichier d'env passé à node. Sortie JSON dans OUT ; résumé à l'écran (aucune URL).
import { createRequire } from "node:module";
import fs from "node:fs";
import crypto from "node:crypto";
const require = createRequire(new URL("../package.json", import.meta.url));
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const q = (sql) => prisma.$queryRawUnsafe(sql);
const h = (v) => crypto.createHash("sha256").update(JSON.stringify(v, (k, x) => (typeof x === "bigint" ? String(x) : x))).digest("hex").slice(0, 16);
const LEGACY = ["calculations", "calculation_annotations", "margin_alerts"];
const out = { label: process.env.LABEL ?? "", at: new Date().toISOString() };

out.columns = await q(`select table_name, column_name, data_type, is_nullable, column_default, ordinal_position from information_schema.columns
  where table_schema='public' and table_name in ('shop_plans','shop_settings','calculations','calculation_annotations','margin_alerts') order by table_name, column_name`);
out.constraints = await q(`select conrelid::regclass::text tbl, conname, pg_get_constraintdef(oid) def from pg_constraint
  where connamespace='public'::regnamespace and conrelid::regclass::text in ('shop_plans','shop_settings','calculations','calculation_annotations','margin_alerts') order by 1,2`);
out.indexes = await q(`select tablename, indexname, indexdef from pg_indexes where schemaname='public' and tablename in ('shop_plans','shop_settings','calculations','calculation_annotations','margin_alerts') order by 1,2`);
out.policies = await q(`select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname='public' and tablename in ('shop_plans','shop_settings','calculations','calculation_annotations','margin_alerts') order by 1,2`);
out.rls = await q(`select relname, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('shop_plans','shop_settings','calculations','calculation_annotations','margin_alerts') order by 1`);
out.triggers = await q(`select tgname, tgrelid::regclass::text tbl, pg_get_triggerdef(oid) def from pg_trigger where not tgisinternal and tgrelid::regclass::text in ('shop_plans','shop_settings') order by 1`);
out.functions = await q(`select proname, pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname in ('purge_shop','sync_shop_plans_to_settings') order by 1`);
out.grants = await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('calculations','calculation_annotations','margin_alerts','shop_plans') order by 1,2,3`);
out.data = {};
for (const t of LEGACY) {
  const exists = (await q(`select to_regclass('public.${t}') is not null e`))[0].e;
  out.data[t] = exists ? { rows: (await q(`select count(*)::int n from public.${t}`))[0].n, hash: h(await q(`select * from public.${t} order by 1`)) } : null;
}
const spCols = out.columns.filter((c) => c.table_name === "shop_plans").map((c) => c.column_name);
out.data.shop_plans = { rows: (await q(`select count(*)::int n from public.shop_plans`))[0].n, hash: h(await q(`select ${spCols.map((c) => `"${c}"`).join(",")} from public.shop_plans order by shop_domain`)) };
out.data.threshold = h(await q(`select shop_domain, profitability_threshold_pct from public.shop_settings order by shop_domain`));
out.data.threshold_values = (await q(`select profitability_threshold_pct v, count(*)::int n from public.shop_settings group by 1 order by 1`)).map((r) => `${r.v ?? "NULL"}×${r.n}`);
out.fingerprint = { structure: h([out.columns, out.constraints, out.indexes, out.policies, out.rls, out.triggers, out.functions, out.grants]), data: h(out.data) };
fs.writeFileSync(process.env.OUT, JSON.stringify(out, (k, x) => (typeof x === "bigint" ? String(x) : x), 2));
const thr = out.columns.find((c) => c.table_name === "shop_settings" && c.column_name === "profitability_threshold_pct");
console.log(`[${out.label}] empreinte structure ${out.fingerprint.structure} · données ${out.fingerprint.data}`);
console.log(`  tables historiques : ${LEGACY.map((t) => `${t}=${out.data[t] ? out.data[t].rows + " lignes" : "absente"}`).join(", ")}`);
console.log(`  shop_plans : ${spCols.length} colonnes (${spCols.join(", ")}), ${out.data.shop_plans.rows} lignes`);
console.log(`  déclencheur de recopie : ${out.triggers.some((t) => t.tgname === "trg_shop_plans_sync_settings") ? "présent" : "absent"} · fonction : ${out.functions.some((f) => f.proname === "sync_shop_plans_to_settings") ? "présente" : "absente"}`);
console.log(`  purge_shop vide les tables historiques : ${/calculations|margin_alerts/.test(out.functions.find((f) => f.proname === "purge_shop")?.def ?? "") ? "oui" : "non"}`);
console.log(`  objectif CM2 : nullable=${thr?.is_nullable} défaut=${thr?.column_default ?? "aucun"} valeurs ${out.data.threshold_values.join(", ")}`);
await prisma.$disconnect();
