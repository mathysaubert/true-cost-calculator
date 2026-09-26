// ── D2-0 : lancer l'app de test « TCC Tarification test » sur tcc-tarif-test, base tcc-test SEULEMENT ──
// Usage : node scripts/d2_0_dev.mjs prepare   écrit shopify.app.tcc-tarif-test.toml et .env.tcc-tarif-test
//         node scripts/d2_0_dev.mjs check     preuve, lecture seule : la base et Supabase vus par l'app = tcc-test
//         node scripts/d2_0_dev.mjs run       garde-fous puis `shopify app dev --config tcc-tarif-test`
// Pourquoi : `shopify app dev --config tcc-tarif-test` charge .env.tcc-tarif-test (pas .env), mais Prisma
// complète depuis .env toute variable ABSENTE (sans écraser les présentes). Le fichier de l'essai couvre donc
// TOUTES les clés de .env, avec les valeurs de tcc-test et de l'app de test ; le lanceur le vérifie avant
// chaque lancement et refuse sinon. Aucune valeur secrète n'est affichée.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CONFIG = "tcc-tarif-test";
const TOML = path.join(ROOT, `shopify.app.${CONFIG}.toml`);
const ENVF = path.join(ROOT, `.env.${CONFIG}`);
const mode = process.argv[2];
// Webhooks gardés dans la configuration de test (aucune donnée client protégée) + conformité RGPD.
const KEEP_TOPICS = ["app/uninstalled", "app/scopes_update", "bulk_operations/finish"];
const PROTECTED_TOPICS = ["orders/", "refunds/", "returns/", "fulfillments/", "fulfillment_events/", "customers/create", "customers/update"];
const fail = (m) => { console.error(`ÉCHEC : ${m}`); process.exit(1); };

const parse = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
};
const refOfUrl = (u) => { try { return new URL(u).hostname.split(".")[0]; } catch { return null; } };
const refOfPg = (u) => { try { return decodeURIComponent(new URL(u).username).split(".")[1] ?? null; } catch { return null; } };
const prod = parse(path.join(ROOT, ".env"));
const test = parse(path.join(ROOT, ".env.test"));
const PROD_REF = refOfUrl(prod.SUPABASE_URL), TEST_REF = refOfUrl(test.SUPABASE_URL);
const label = (ref) => (ref && ref === TEST_REF ? "tcc-test" : ref && ref === PROD_REF ? "PRODUCTION" : "inconnue");
if (!PROD_REF || !TEST_REF || PROD_REF === TEST_REF) fail("références des projets Supabase illisibles dans .env / .env.test");

if (mode === "prepare") {
  for (const k of ["PRICING_TEST_CLIENT_ID", "PRICING_TEST_CLIENT_SECRET", "PRICING_TEST_SHOP"]) if (!test[k]) fail(`${k} manquant dans .env.test`);
  // Configuration : copie de shopify.app.toml, identité et adresses de l'app de test seulement.
  let toml = fs.readFileSync(path.join(ROOT, "shopify.app.toml"), "utf8").replace(/\r\n/g, "\n");
  const scopes = toml.match(/^scopes = "([^"]+)"/m)?.[1];
  if (!scopes) fail("scopes introuvables dans shopify.app.toml");
  const swap = (re, to, what) => { if (!re.test(toml)) fail(`shopify.app.toml : ${what} introuvable`); toml = toml.replace(re, to); };
  swap(/^client_id = ".*"$/m, `client_id = "${test.PRICING_TEST_CLIENT_ID}"`, "client_id");
  swap(/^name = ".*"$/m, `name = "tcc-tarification-test"`, "name");
  swap(/^application_url = ".*"$/m, `application_url = "https://example.com"`, "application_url");
  swap(/uri = "https:\/\/[^"]+\/webhooks\/compliance"/, `uri = "/webhooks/compliance"`, "webhook compliance");
  swap(/^redirect_urls = \[.*\]$/m, `redirect_urls = [ "https://example.com/api/auth" ]`, "redirect_urls");
  // Pour l'app de TEST uniquement : `app dev` y remplace les adresses par celles du tunnel (la vraie app garde false).
  swap(/^automatically_update_urls_on_dev = false$/m, "automatically_update_urls_on_dev = true", "automatically_update_urls_on_dev");
  // L'app de test n'est pas approuvée pour les données client protégées : Shopify refuse alors de démarrer
  // si elle s'abonne aux webhooks qui en contiennent (commandes, remboursements, retours, expéditions).
  // D2-0 ne teste que la facturation : on ne garde que les webhooks sans données client.
  const blocks = toml.split(/\n(?=  \[\[webhooks\.subscriptions\]\])/);
  const kept = blocks.filter((b, i) => i === 0 || KEEP_TOPICS.some((t) => b.includes(`"${t}"`)) || /compliance_topics/.test(b));
  const dropped = blocks.length - kept.length;
  toml = kept.join("\n").replace(/\n  # F2 — commandes[^\n]*\n(?=\n|  \[\[)/g, "\n");
  const head = `# D2-0 — configuration de l'app de TEST « TCC Tarification test » (Dev Dashboard), générée par\n# scripts/d2_0_dev.mjs prepare depuis shopify.app.toml. Ne pas utiliser pour la vraie app.\n# Webhooks à données client protégées retirés (${dropped} abonnements) : l'essai ne porte que sur la facturation.\n`;
  fs.writeFileSync(TOML, head + toml.replace(/^# Learn more.*\n/m, ""));
  // Variables : toutes les clés de .env, valeurs tcc-test + app de test ; BETA_SHOPS vide (pas la liste de prod).
  const env = {
    SHOPIFY_API_KEY: test.PRICING_TEST_CLIENT_ID,
    SHOPIFY_API_SECRET: test.PRICING_TEST_CLIENT_SECRET,
    SCOPES: scopes,
    SUPABASE_URL: test.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: test.SUPABASE_SERVICE_KEY,
    DATABASE_URL: test.DATABASE_URL,
    DIRECT_URL: test.DIRECT_URL,
    TOKEN_ENCRYPTION_KEY: test.TOKEN_ENCRYPTION_KEY,
    BETA_SHOPS: "",
  };
  for (const [k, v] of Object.entries(env)) if (v == null) fail(`${k} : valeur source manquante`);
  fs.writeFileSync(ENVF, `# D2-0 — généré par scripts/d2_0_dev.mjs prepare ; base tcc-test et app de test. Jamais dans le chat.\n` + Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  console.log(`écrit : ${path.basename(TOML)} (client de l'app de test, adresses d'exemple remplacées au lancement)`);
  console.log(`écrit : ${path.basename(ENVF)} (${Object.keys(env).length} variables, ignoré par git)`);
  process.exit(0);
}

// ── Garde-fous communs à check et run ──
if (!fs.existsSync(TOML) || !fs.existsSync(ENVF)) fail("lancer d'abord : node scripts/d2_0_dev.mjs prepare");
const ign = spawnSync("git", ["check-ignore", "-q", ENVF], { cwd: ROOT });
if (ign.status !== 0) fail(`.env.${CONFIG} n'est pas ignoré par git`);
const e = parse(ENVF);
const toml = fs.readFileSync(TOML, "utf8");
const problems = [];
// SHOPIFY_APP_URL volontairement ABSENTE : vite.config.js ne prend l'adresse du tunnel (HOST, fournie par la CLI)
// que si SHOPIFY_APP_URL est vide, et la pose avant le chargement de .env par React Router (qui ne l'écrase donc
// pas). Seul Prisma, qui ne s'en sert pas, peut la lire dans .env. La preuve vérifie l'adresse retenue.
const TUNNEL_KEYS = ["SHOPIFY_APP_URL"];
if ("SHOPIFY_APP_URL" in e) problems.push("SHOPIFY_APP_URL doit être absente (sinon Vite bloque l'adresse du tunnel)");
const missing = Object.keys(prod).filter((k) => !(k in e) && !TUNNEL_KEYS.includes(k));
if (missing.length) problems.push(`clés de .env absentes du fichier de l'essai (Prisma les prendrait dans .env) : ${missing.join(", ")}`);
for (const [k, ref] of [["SUPABASE_URL", refOfUrl(e.SUPABASE_URL)], ["DATABASE_URL", refOfPg(e.DATABASE_URL)], ["DIRECT_URL", refOfPg(e.DIRECT_URL)]]) if (ref !== TEST_REF) problems.push(`${k} vise la base ${label(ref)}`);
if (e.SHOPIFY_API_KEY !== test.PRICING_TEST_CLIENT_ID || e.SHOPIFY_API_KEY === prod.SHOPIFY_API_KEY) problems.push("SHOPIFY_API_KEY n'est pas celui de l'app de test");
if (!toml.includes(`client_id = "${test.PRICING_TEST_CLIENT_ID}"`) || (prod.SHOPIFY_API_KEY && toml.includes(prod.SHOPIFY_API_KEY))) problems.push("la configuration ne vise pas l'app de test");
if (/true-cost-calculator-silk/.test(toml)) problems.push("la configuration contient encore l'adresse de production");
if (e.BETA_SHOPS) problems.push("BETA_SHOPS doit rester vide pour l'essai");
const topics = [...toml.matchAll(/^\s*topics = \[([^\]]*)\]/gm)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
const bad = topics.filter((t) => PROTECTED_TOPICS.some((p) => t.startsWith(p)));
if (bad.length) problems.push(`webhooks à données client protégées dans la configuration de test : ${bad.join(", ")}`);
if (!KEEP_TOPICS.every((t) => topics.includes(t)) || !/compliance_topics = \["customers\/data_request", "customers\/redact", "shop\/redact"\]/.test(toml)) problems.push("webhooks de base ou de conformité manquants");
if (problems.length) fail("garde-fous :\n  - " + problems.join("\n  - "));
console.log(`garde-fous : OK (${Object.keys(prod).length - 1} clés de .env couvertes + SHOPIFY_APP_URL laissée au tunnel, Supabase et Postgres = tcc-test, app de test, BETA_SHOPS vide)`);

// Environnement transmis à la CLI par `run`. Mesuré dans la CLI 3.94.3 : la commande de démarrage de l'app
// (prisma migrate deploy puis react-router dev) reçoit l'environnement de la CLI + ses variables (fonction VKi,
// execa extendEnv) et PAS le fichier .env.<config>. Vite (loadEnv) puis Prisma ne complètent depuis .env que les
// variables ABSENTES. Le lanceur doit donc passer lui-même les variables de tcc-test à la CLI.
const cliEnv = () => { const env = { ...process.env }; for (const k of [...Object.keys(prod), ...Object.keys(test)]) delete env[k]; return Object.assign(env, e); };
// Ce que la CLI ajoute pour la commande de démarrage (VKi) : { ...cliEnv, ...ces variables }.
const TUNNEL = "https://tunnel-de-preuve.trycloudflare.com"; // adresse fictive, jouée par la CLI au vrai lancement
const appEnvFromCli = () => ({ ...cliEnv(), SHOPIFY_API_KEY: e.SHOPIFY_API_KEY, SHOPIFY_API_SECRET: e.SHOPIFY_API_SECRET, HOST: TUNNEL, SCOPES: e.SCOPES, NODE_ENV: "development", APP_URL: TUNNEL, APP_ENV: "development", PORT: "3000", SERVER_PORT: "3000" });
const hostLabel = (h) => (h === new URL(test.DIRECT_URL).host || h === new URL(test.DATABASE_URL).host ? "tcc-test" : h === new URL(prod.DIRECT_URL).host || h === new URL(prod.DATABASE_URL).host ? "PRODUCTION" : "inconnue");

if (mode === "check") {
  // Sonde exécutée dans l'environnement exact de l'app : celui de la CLI (appEnvFromCli), puis le chargement de
  // .env par React Router (Object.assign(process.env, vite.loadEnv(mode, racine, ""))), depuis la racine où .env existe.
  const probe = `
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    const require = createRequire(process.cwd() + "/package.json");
    const vite = await import(pathToFileURL(require.resolve("vite")).href);
    if (process.env.PROBE_VITE === "1") {
      // Même logique que vite.config.js (évalué AVANT le chargement de .env par React Router), puis ce chargement.
      if (process.env.HOST && (!process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL === process.env.HOST)) { process.env.SHOPIFY_APP_URL = process.env.HOST; delete process.env.HOST; }
      globalThis.__allowed = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;
      Object.assign(process.env, vite.loadEnv("development", process.cwd(), ""));
    }
    const { PrismaClient } = require("@prisma/client");
    const { createClient } = require("@supabase/supabase-js");
    const p = new PrismaClient();
    const [{ id }] = await p.$queryRawUnsafe("select system_identifier::text id from pg_control_system()");
    const sessions = await p.session.count();
    const tables = await p.$queryRawUnsafe("select count(*)::int n from information_schema.tables where table_schema='public'");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
    const { error } = await sb.from("shop_settings").select("shop_domain", { head: true, count: "exact" });
    console.log(JSON.stringify({ id, sessions, tables: tables[0].n, supabaseRef: new URL(process.env.SUPABASE_URL).hostname.split(".")[0], supabaseOk: !error, allowedHost: globalThis.__allowed ?? null, appUrl: process.env.SHOPIFY_APP_URL ?? null, apiKeyIsTest: process.env.SHOPIFY_API_KEY === process.env.PROBE_TEST_KEY, betaEmpty: !process.env.BETA_SHOPS }));
    await p.$disconnect();`;
  const sonde = (env) => spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: ROOT, env, encoding: "utf8" });
  const read = (x, what) => { if (x.status !== 0) fail(`${what} : ` + String(x.stderr).split("\n").filter(Boolean).slice(-3).join(" | ").replace(/postgres(ql)?:\/\/\S+/g, "<url>")); return JSON.parse(x.stdout.trim().split("\n").pop()); };
  // Identifiants système des deux bases, lus directement (lecture seule) pour comparaison.
  const sysId = (vars) => { const env2 = { ...process.env }; for (const k of [...Object.keys(prod), ...Object.keys(test)]) delete env2[k]; Object.assign(env2, { DATABASE_URL: vars.DATABASE_URL, DIRECT_URL: vars.DIRECT_URL, SUPABASE_URL: vars.SUPABASE_URL, SUPABASE_SERVICE_KEY: vars.SUPABASE_SERVICE_KEY }); return read(sonde(env2), "lecture de référence").id; };
  const testId = sysId(test), prodId = sysId(prod);
  if (!testId || !prodId || testId === prodId) fail("bases de référence non distinguables");
  const which = (id) => (id === testId ? "tcc-test" : id === prodId ? "PRODUCTION" : "inconnue");
  const got = read(sonde({ ...appEnvFromCli(), PROBE_VITE: "1", PROBE_TEST_KEY: test.PRICING_TEST_CLIENT_ID }), "sonde de l'app");
  console.log(`app démarrée (environnement CLI + chargement .env par React Router) : Prisma → ${which(got.id)} ; Supabase → ${label(got.supabaseRef)} (lecture ${got.supabaseOk ? "OK" : "en échec"}) ; clé = app de test : ${got.apiKeyIsTest ? "oui" : "NON"} ; BETA_SHOPS vide : ${got.betaEmpty ? "oui" : "NON"}`);
  // Témoin négatif : sans les variables du lanceur (ce qu'a fait la première relance), la même sonde vise la production.
  const bare = { ...process.env }; for (const k of [...Object.keys(prod), ...Object.keys(test)]) delete bare[k];
  const neg = read(sonde({ ...bare, SHOPIFY_API_KEY: e.SHOPIFY_API_KEY, SHOPIFY_API_SECRET: e.SHOPIFY_API_SECRET, SCOPES: e.SCOPES, PROBE_VITE: "1" }), "témoin négatif");
  console.log(`témoin sans le correctif (variables de la CLI seules) : Prisma → ${which(neg.id)} ; Supabase → ${label(neg.supabaseRef)}  [reproduit l'incident, lecture seule]`);
  // Démarrage réel : `prisma migrate deploy` dans l'environnement de la CLI ; `migrate status` (lecture seule) donne l'hôte visé.
  const st = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "status"], { cwd: ROOT, env: appEnvFromCli(), encoding: "utf8", shell: process.platform === "win32" });
  const txt = st.stdout + st.stderr;
  const host = txt.match(/at "([^"]+)"/)?.[1] ?? null;
  const upToDate = /Database schema is up to date/i.test(txt);
  console.log(`prisma migrate (démarrage) : hôte → ${host ? hostLabel(host) : "illisible"} ; ${upToDate ? "à jour, rien à appliquer" : "PAS à jour — ne rien lancer sans GO"}`);
  const tunnelHost = new URL(TUNNEL).hostname;
  const urlOk = got.allowedHost === tunnelHost && got.appUrl === TUNNEL;
  console.log(`adresse de l'app : hôte autorisé par Vite = ${got.allowedHost === tunnelHost ? "celui du tunnel" : got.allowedHost}, SHOPIFY_APP_URL = ${got.appUrl === TUNNEL ? "tunnel" : got.appUrl === prod.SHOPIFY_APP_URL ? "PRODUCTION" : "autre"}`);
  const okAll = urlOk && which(got.id) === "tcc-test" && label(got.supabaseRef) === "tcc-test" && got.apiKeyIsTest && got.betaEmpty && host && hostLabel(host) === "tcc-test" && upToDate && which(neg.id) === "PRODUCTION";
  if (!okAll) fail("preuve incomplète : ne pas lancer");
  console.log("PREUVE : l'app de test lancée par ce lanceur ne voit que tcc-test (et le témoin confirme la cause de l'incident).");
  process.exit(0);
}

if (mode === "run") {
  const store = test.PRICING_TEST_SHOP;
  // La preuve complète (lecture seule) est refaite avant CHAQUE lancement ; échec = pas de lancement.
  const proof = spawnSync(process.execPath, [path.join(ROOT, "scripts", "d2_0_dev.mjs"), "check"], { cwd: ROOT, stdio: "inherit", env: process.env });
  if (proof.status !== 0) fail("preuve en échec : lancement refusé");
  console.log(`lancement : shopify app dev --config ${CONFIG} --store ${store} (variables tcc-test transmises à la CLI)`);
  // Diagnostic : si Node s'arrête brutalement (ex. 0xC0000409 au premier lancement), il laisse un rapport ici.
  const reports = path.join(ROOT, "node_modules", ".cache", "d2_0-reports");
  fs.mkdirSync(reports, { recursive: true });
  const env = cliEnv();
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --report-on-fatalerror --report-uncaught-exception --report-directory="${reports}"`.trim();
  console.log(`rapports de diagnostic en cas d'arrêt brutal : node_modules/.cache/d2_0-reports`);
  const r = spawnSync("shopify", ["app", "dev", "--config", CONFIG, "--store", store], { cwd: ROOT, stdio: "inherit", env, shell: process.platform === "win32" });
  process.exit(r.status ?? 1);
}

fail("mode attendu : prepare | check | run");
