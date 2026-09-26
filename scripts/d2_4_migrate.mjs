// ── D2-4 : application de 20260926_d2_01_drop_legacy.sql, avec retour arrière généré depuis la base ──
// Usage : TARGET=test|prod PGBIN=<dossier pg_dump/psql 17> BUNDLE=<dossier du retour arrière>
//         node --env-file=<.env.test|.env> scripts/d2_4_migrate.mjs <mode>
// Modes :
//   seed-test    base de TEST seulement : lignes fictives dans les tables touchées (preuve sur données)
//   prepare      LECTURE : écrit BUNDLE/rollback.sql (tables retirées par pg_dump, fonctions, déclencheur,
//                colonnes et valeurs retirées de shop_plans, valeurs de l'objectif CM2)
//   apply        applique la migration en UNE transaction (arrêt à la première erreur)
//   rollback     applique BUNDLE/rollback.sql en UNE transaction
//   purge-check  base de TEST seulement : purge_shop sur les boutiques fictives, vérifie qu'il ne reste rien
// Garde-fous : la base visée doit correspondre à TARGET (référence du projet comparée à .env / .env.test) ;
// la connexion n'est jamais affichée (variables d'environnement, messages masqués).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const require = createRequire(path.join(ROOT, "package.json"));
const { PrismaClient } = require("@prisma/client");
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260926_d2_01_drop_legacy.sql");
const mode = process.argv[2];
const TARGET = process.env.TARGET;
const BUNDLE = process.env.BUNDLE;
const PGBIN = process.env.PGBIN;
const fail = (m) => { console.error(`ÉCHEC : ${m}`); process.exit(1); };
if (!["test", "prod"].includes(TARGET)) fail("TARGET=test|prod requis");

// ── Garde-fou : la base visée est bien celle annoncée ──
const refOf = (file) => { try { const m = fs.readFileSync(path.join(ROOT, file), "utf8").match(/^SUPABASE_URL\s*=\s*["']?https:\/\/([a-z0-9]+)\./m); return m ? m[1] : null; } catch { return null; } };
const u = new URL(process.env.DIRECT_URL);
const ref = decodeURIComponent(u.username).split(".")[1];
const expected = refOf(TARGET === "prod" ? ".env" : ".env.test"), other = refOf(TARGET === "prod" ? ".env.test" : ".env");
if (!ref || ref !== expected || ref === other) fail(`la base visée ne correspond pas à TARGET=${TARGET}`);
const env = { ...process.env, PGHOST: u.hostname, PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: u.pathname.slice(1) || "postgres", PGSSLMODE: "require" };
delete env.DIRECT_URL; delete env.DATABASE_URL;
const mask = (s) => String(s ?? "").replaceAll(env.PGPASSWORD, "***").replaceAll(env.PGHOST, "<hôte>").replaceAll(env.PGUSER, "<utilisateur>");
const tool = (name, args) => { if (!PGBIN) fail("PGBIN requis"); const r = spawnSync(path.join(PGBIN, `${name}.exe`), args, { env, encoding: "utf8", maxBuffer: 1 << 27 }); return { code: r.status, out: r.stdout ?? "", err: mask(r.stderr) }; };
const psqlFile = (file, label) => {
  const r = tool("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", file]);
  console.log(`${label} : ${r.code === 0 ? "OK (transaction validée)" : "ÉCHEC (transaction annulée, base inchangée)"}`);
  if (r.err.trim()) console.log("  messages : " + r.err.trim().split("\n").slice(0, 8).join("\n  "));
  if (r.code !== 0) process.exit(1);
};
const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
const q = (sql) => prisma.$queryRawUnsafe(sql);
const lit = (v) => (v == null ? "NULL" : typeof v === "number" || typeof v === "bigint" ? String(v) : v instanceof Date ? `'${v.toISOString()}'` : typeof v === "object" && v.constructor?.name === "Decimal" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);
const LEGACY_TABLES = ["calculations", "calculation_annotations", "margin_alerts"];
const SP_COLUMNS = ["vat_regime", "shipping_model", "default_import_country", "shopify_fee_pct", "processor_fee_pct", "processor_fixed_fee", "profitability_threshold_pct", "current_cpa", "current_cpa_updated_at"];
const SEED = ["d24-proof-a.myshopify.com", "d24-proof-b.myshopify.com"];

console.log(`[${TARGET}] mode ${mode}`);
if (mode === "seed-test") {
  if (TARGET !== "test") fail("seed-test : base de test seulement");
  const [a, b] = SEED;
  await prisma.$executeRawUnsafe(`INSERT INTO public.shop_settings (shop_domain, profitability_threshold_pct) VALUES ('${a}', 0), ('${b}', 45) ON CONFLICT (shop_domain) DO UPDATE SET profitability_threshold_pct = EXCLUDED.profitability_threshold_pct`);
  await prisma.$executeRawUnsafe(`INSERT INTO public.shop_plans (shop_domain, plan, vat_regime, shipping_model, default_import_country, shopify_fee_pct, processor_fee_pct, processor_fixed_fee, profitability_threshold_pct, current_cpa, current_cpa_updated_at)
    VALUES ('${a}', 'expert', 'franchise', 'stock', 'UE', 0, 1.8, 0.3, 12.5, 7.25, '2026-09-20T10:00:00Z'), ('${b}', 'pro', 'assujetti', 'dropshipping', 'Chine', 2, 1.5, 0.25, 0, NULL, NULL) ON CONFLICT (shop_domain) DO NOTHING`);
  const c = await q(`INSERT INTO public.calculations (shop_domain, purchase_price, selling_price, category, country, net_margin_percent, net_margin_euros, product_title) VALUES ('${a}', 12, 39.9, 'Textile', 'Chine', 31.2, 12.45, 'Tee test D2-4'), ('${b}', 30, 49, 'Sport', 'UE', -4.5, -2.2, NULL) RETURNING id`);
  await prisma.$executeRawUnsafe(`INSERT INTO public.calculation_annotations (shop_domain, calculation_id, note) VALUES ('${a}', '${c[0].id}', 'Note d''essai D2-4')`);
  await prisma.$executeRawUnsafe(`INSERT INTO public.margin_alerts (shop_domain, threshold) VALUES ('${a}', 30) ON CONFLICT (shop_domain) DO NOTHING`);
  console.log("lignes fictives insérées : 2 réglages (objectif 0 et 45), 2 offres avec réglages, 2 calculs, 1 annotation, 1 seuil d'alerte");
} else if (mode === "prepare") {
  if (!BUNDLE) fail("BUNDLE requis");
  fs.mkdirSync(BUNDLE, { recursive: true });
  const present = [];
  for (const t of LEGACY_TABLES) if ((await q(`select to_regclass('public.${t}') is not null e`))[0].e) present.push(t);
  const dump = present.length ? tool("pg_dump", ["--format=plain", ...present.flatMap((t) => ["--table", `public.${t}`])]) : { code: 0, out: "" };
  if (dump.code !== 0) fail(`pg_dump des tables : ${dump.err}`);
  const fn = async (name) => (await q(`select pg_get_functiondef(p.oid) d from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='${name}'`))[0]?.d ?? null;
  const purgeDef = await fn("purge_shop"), syncDef = await fn("sync_shop_plans_to_settings");
  const trig = (await q(`select pg_get_triggerdef(oid) d from pg_trigger where tgname='trg_shop_plans_sync_settings' and not tgisinternal`))[0]?.d ?? null;
  const cols = await q(`select a.attname col, format_type(a.atttypid, a.atttypmod) typ, a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.shop_plans'::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`);
  const drop = cols.filter((c) => SP_COLUMNS.includes(c.col));
  const spRows = drop.length ? await q(`select shop_domain, ${drop.map((c) => `"${c.col}"`).join(", ")} from public.shop_plans order by shop_domain`) : [];
  const thrCol = (await q(`select is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='shop_settings' and column_name='profitability_threshold_pct'`))[0];
  const thr = await q(`select shop_domain, profitability_threshold_pct v from public.shop_settings order by shop_domain`);
  const L = [];
  L.push(`-- Retour arrière D2-4 généré le ${new Date().toISOString()} depuis la base ${TARGET} (avant application).`);
  L.push("-- À appliquer en une transaction : psql --single-transaction -v ON_ERROR_STOP=1 -f rollback.sql");
  if (syncDef) L.push("-- 1. Fonction de recopie shop_plans → shop_settings", `${syncDef};`);
  if (drop.length) {
    L.push("-- 2. Colonnes de réglages de shop_plans (définitions exactes), puis leurs valeurs");
    for (const c of drop) L.push(`ALTER TABLE public.shop_plans ADD COLUMN IF NOT EXISTS "${c.col}" ${c.typ}${c.def ? ` DEFAULT ${c.def}` : ""};`);
    for (const r of spRows) L.push(`UPDATE public.shop_plans SET ${drop.map((c) => `"${c.col}" = ${lit(r[c.col])}`).join(", ")} WHERE shop_domain = ${lit(r.shop_domain)};`);
    for (const c of drop.filter((x) => x.nn)) L.push(`ALTER TABLE public.shop_plans ALTER COLUMN "${c.col}" SET NOT NULL;`);
  }
  if (trig) L.push("-- 3. Déclencheur de recopie", `${trig};`);
  if (dump.out) L.push("-- 4. Tables de l'écran classique (pg_dump : structure, données, index, politiques, droits)", dump.out, "SELECT pg_catalog.set_config('search_path', 'public', false);");
  if (purgeDef) L.push("-- 5. Définition précédente de purge_shop (après les tables : le corps SQL est vérifié à la création)", `${purgeDef};`);
  L.push("-- 6. Objectif de marge CM2 : valeurs et contrainte d'avant");
  if (thrCol?.column_default) L.push(`ALTER TABLE public.shop_settings ALTER COLUMN profitability_threshold_pct SET DEFAULT ${thrCol.column_default};`);
  for (const r of thr) L.push(`UPDATE public.shop_settings SET profitability_threshold_pct = ${lit(r.v)} WHERE shop_domain = ${lit(r.shop_domain)};`);
  if (thrCol?.is_nullable === "NO") L.push(`UPDATE public.shop_settings SET profitability_threshold_pct = ${thrCol.column_default ?? 0} WHERE profitability_threshold_pct IS NULL;`, "ALTER TABLE public.shop_settings ALTER COLUMN profitability_threshold_pct SET NOT NULL;");
  fs.writeFileSync(path.join(BUNDLE, "rollback.sql"), L.join("\n") + "\n");
  console.log(`retour arrière écrit : ${present.length} table(s) (${present.join(", ")}), ${drop.length} colonne(s) de shop_plans et ${spRows.length} ligne(s), fonctions ${[syncDef && "recopie", purgeDef && "purge_shop"].filter(Boolean).join(" + ")}, déclencheur ${trig ? "oui" : "non"}, objectif ${thr.length} ligne(s) ; ${(fs.statSync(path.join(BUNDLE, "rollback.sql")).size / 1024).toFixed(0)} Ko`);
} else if (mode === "apply") {
  psqlFile(MIGRATION, "migration 20260926_d2_01_drop_legacy.sql");
} else if (mode === "rollback") {
  if (!BUNDLE || !fs.existsSync(path.join(BUNDLE, "rollback.sql"))) fail("BUNDLE/rollback.sql absent : lancer prepare avant apply");
  psqlFile(path.join(BUNDLE, "rollback.sql"), "retour arrière");
} else if (mode === "purge-check") {
  if (TARGET !== "test") fail("purge-check : base de test seulement");
  // purge_shop renvoie void (non lisible par Prisma en lecture) : appel par exécution.
  for (const s of SEED) await prisma.$executeRawUnsafe(`select public.purge_shop('${s}')`);
  const left = [];
  for (const t of ["shop_settings", "shop_plans"]) { const n = (await q(`select count(*)::int n from public.${t} where shop_domain in (${SEED.map(lit).join(",")})`))[0].n; if (n) left.push(`${t}=${n}`); }
  console.log(`purge_shop sur les 2 boutiques fictives : ${left.length ? "RESTE " + left.join(", ") : "OK, plus aucune ligne"}`);
  if (left.length) process.exit(1);
} else fail("mode inconnu");
await prisma.$disconnect();
