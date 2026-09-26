// ════════════════════════════════════════════════════════════════════════════════
//  LOT 40 — D2-4 (2026-09-26) : retrait en base de l'écran classique + objectif de marge « non renseigné ».
//  1. Migration 20260926_d2_01 : ordre imposé (purge_shop d'abord), tables / déclencheur / colonnes
//     retirés, plan gardé, objectif facultatif sans défaut, 0 jamais choisis → NULL, aucune autre donnée.
//  2. Plus aucun code de l'app ne lit les tables ou colonnes retirées.
//  3. Objectif : vide = non renseigné (NULL), 0 saisi = vrai 0 ; mise en route, audit, cron et e-mail.
//  4. Outils de migration : garde-fou de la base visée, retour arrière généré depuis la base.
//  Pour lancer : node tests/lot40_d2_4_legacy_drop.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderLossAlertEmail, computeProfitabilityChanges } from "../app/lib/profitabilityAlert.js";
import { settingsStatus, parseFields, FIELDS } from "../app/lib/settings.js";
import { classifyAuditRows } from "../app/lib/products.js";
import { DROPPED_TABLES, ALL_TABLES } from "../app/lib/schema.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const MIG = read("supabase/migrations/20260926_d2_01_drop_legacy.sql");
const sql = MIG.replace(/--.*$/gm, "");
const REMOVED_COLS = ["vat_regime", "shipping_model", "default_import_country", "shopify_fee_pct", "processor_fee_pct", "processor_fixed_fee", "profitability_threshold_pct", "current_cpa", "current_cpa_updated_at"];

console.log("\n── 1. Migration ──");
{
  const at = (re) => sql.search(re);
  const purge = at(/CREATE OR REPLACE FUNCTION public\.purge_shop/), trig = at(/DROP TRIGGER IF EXISTS trg_shop_plans_sync_settings/),
    tables = at(/DROP TABLE IF EXISTS public\.calculation_annotations/), cols = at(/ALTER TABLE public\.shop_plans/), goal = at(/ALTER TABLE public\.shop_settings/);
  ok(purge >= 0 && purge < trig && trig < tables && tables < cols && cols < goal, "ordre : purge_shop, déclencheur, tables, colonnes, objectif");
  const body = sql.slice(purge, sql.indexOf("$$;", purge));
  ok(DROPPED_TABLES.every((t) => !new RegExp(`public\\.${t}\\b`).test(body)), "purge_shop ne cite plus aucune table retirée");
  ok((body.match(/DELETE FROM public\.\w+/g) ?? []).length === 36 && /DELETE FROM public\.decision_log/.test(body) && /DELETE FROM public\.shop_settings/.test(body), "purge_shop vide toujours les 36 autres tables (dont shop_settings et decision_log)");
  ok(/DROP FUNCTION IF EXISTS public\.sync_shop_plans_to_settings\(\)/.test(sql), "fonction de recopie shop_plans → shop_settings retirée");
  ok(DROPPED_TABLES.every((t) => new RegExp(`DROP TABLE IF EXISTS public\\.${t};`).test(sql)) && !/CASCADE/i.test(sql), "3 tables retirées, sans CASCADE (une dépendance inconnue ferait échouer toute la transaction)");
  ok(sql.indexOf("calculation_annotations;") < sql.indexOf("public.calculations;"), "annotations retirées avant calculations (clé étrangère)");
  const alter = sql.slice(cols, goal);
  ok(REMOVED_COLS.every((c) => new RegExp(`DROP COLUMN IF EXISTS ${c}\\b`).test(alter)) && (alter.match(/DROP COLUMN/g) ?? []).length === 9 && !/\bplan\b/.test(alter.replace(/shop_plans/g, "")), "9 colonnes de réglages retirées de shop_plans, plan gardé");
  ok(/ALTER COLUMN profitability_threshold_pct DROP NOT NULL/.test(sql) && /ALTER COLUMN profitability_threshold_pct DROP DEFAULT/.test(sql), "objectif CM2 facultatif et sans défaut");
  ok(/UPDATE public\.shop_settings SET profitability_threshold_pct = NULL WHERE profitability_threshold_pct = 0;/.test(sql) && (sql.match(/\bUPDATE\b/g) ?? []).length === 1 && !/\bDELETE\b/.test(sql.replace(body, "")) && !/\bINSERT\b/.test(sql), "seule donnée modifiée : objectifs à 0 → NULL (aucune autre mise à jour, suppression ni insertion)");
  ok(!/BEGIN|COMMIT/i.test(sql), "pas de BEGIN/COMMIT dans le fichier : la transaction unique vient de psql --single-transaction");
  ok(!/supabase\/rollback/.test(MIG), "aucun renvoi vers un fichier de retour arrière inexistant");
  ok(ALL_TABLES.every((t) => !DROPPED_TABLES.includes(t)), "contrat de schéma : les tables retirées ne sont plus attendues");
}

console.log("\n── 2. Code de l'app ──");
{
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f)) files.push(p); } };
  walk(new URL("../app", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const src = files.filter((f) => !/[\\/]locales[\\/]/.test(f)).map((f) => [f, readFileSync(f, "utf8").replace(/\/\/.*$/gm, "")]);
  const hits = src.filter(([, s]) => DROPPED_TABLES.some((t) => new RegExp(`from\\(["'\`]${t}["'\`]\\)`).test(s)));
  ok(hits.length === 0, `aucune lecture ni écriture des tables retirées (${hits.map(([f]) => f).join(", ") || "aucune"})`);
  const plans = src.filter(([, s]) => /from\(["']shop_plans["']\)/.test(s));
  const plansCols = plans.flatMap(([, s]) => [...s.matchAll(/from\(["']shop_plans["']\)[\s\S]{0,200}?\.(select|upsert)\(([\s\S]{0,160}?)\)/g)].map((m) => m[2]));
  ok(plans.length === 1 && plansCols.length === 2 && plansCols.every((c) => !REMOVED_COLS.some((col) => new RegExp(`\\b${col}\\b`).test(c))), "shop_plans : seul plan.server.js y touche, sans colonne retirée");
}

console.log("\n── 3. Objectif « non renseigné » ──");
{
  const empty = new FormData(); empty.set("profitability_threshold_pct", "");
  const zero = new FormData(); zero.set("profitability_threshold_pct", "0");
  ok(parseFields(FIELDS.goals, empty).values.profitability_threshold_pct === null && parseFields(FIELDS.goals, zero).values.profitability_threshold_pct === 0, "saisie : vide → NULL, 0 → 0");
  ok(!/profitability_threshold_pct = 0/.test(read("app/routes/app.settings.goals.jsx").replace(/\/\/.*$/gm, "")), "action Objectifs : le vide n'est plus réécrit en 0");
  ok(/value=\{settings\[f\.key\]\}/.test(read("app/components/settings/GoalsForm.jsx")), "formulaire : 0 affiché « 0 », NULL affiché vide");
  const cm2 = (v) => settingsStatus({ settings: { profitability_threshold_pct: v }, fixedCosts: [], gateways: [], day: "2026-09-26" }).find((i) => i.id === "cm2_target").state;
  ok(cm2(null) === "unset" && cm2(undefined) === "unset" && cm2(0) === "set" && cm2(25) === "set", "mise en route : NULL = manquant, 0 ou 25 = renseigné");
  ok(/profitability_threshold_pct == null \? null/.test(read("app/lib/audit.server.js")) && /profitability_threshold_pct == null \? null/.test(read("app/lib/overview.server.js")), "audit et Produits : NULL transmis tel quel (plus de repli silencieux à 0)");
  const rows = [{ cm2_pct: -3 }, { cm2_pct: 10 }, { cm2_pct: 30 }];
  const g = classifyAuditRows(rows, null ?? 0);
  ok(g.loser.length === 1 && g.risky.length === 0 && g.winner.length === 2, "audit sans objectif : classement à perte stricte (même calcul qu'avant)");
  const cron = read("app/routes/api.cron.profitability.jsx");
  ok(/const thresholdPct = thresholdRaw \?\? 0;/.test(cron) && /computeProfitabilityChanges\(agg\.byProduct, prevMap, thresholdPct\)/.test(cron) && /thresholdPct: thresholdRaw \}/.test(cron), "cron : calcul à 0 si NULL (inchangé), e-mail reçoit NULL");
  const cur = [{ product_id: "p1", title: "Cap", net_margin: -5, net_revenue: 100, currency: "EUR" }];
  const a = computeProfitabilityChanges(cur, new Map(), null ?? 0), b = computeProfitabilityChanges(cur, new Map(), 0);
  ok(JSON.stringify(a) === JSON.stringify(b), "calcul des basculements identique pour NULL (→ 0) et 0");
  const loss = [{ to: "loss", margin: -5, marginPct: -5, currency: "EUR", title: "Cap" }];
  const none = renderLossAlertEmail({ shop: "s.myshopify.com", thresholdPct: null, basculements: loss });
  const zeroMail = renderLossAlertEmail({ shop: "s.myshopify.com", thresholdPct: 0, basculements: loss });
  ok(/1 produit est à perte\./.test(none.text) && !/objectif/.test(none.text) && !/objectif/.test(none.html) && !/null/.test(none.html), "e-mail sans objectif : « 1 produit est à perte », jamais « objectif » ni « null »");
  ok(/sous votre objectif de marge \(0 %\)/.test(zeroMail.text), "e-mail avec objectif 0 % choisi : formulation historique conservée");
  const rec = renderLossAlertEmail({ shop: "s.myshopify.com", thresholdPct: null, basculements: [{ to: "profitable", margin: 4, marginPct: 4, currency: "EUR", title: "Cap" }] });
  ok(/1 produit est repassé rentable\./.test(rec.text) && /Repassés rentables :/.test(rec.text) && /Repassés rentables<\/h3>/.test(rec.html) && !/objectif/.test(rec.text), "e-mail de retour sans objectif : « repassé rentable », texte et HTML alignés");
  const t = renderLossAlertEmail({ shop: "s.myshopify.com", thresholdPct: 25, basculements: [{ to: "loss", margin: 3, marginPct: 10, currency: "EUR", title: "Bag" }] });
  ok(/sous votre objectif de marge \(25 %\)/.test(t.text) && /15 points sous votre objectif/.test(t.text), "e-mail avec objectif 25 % : inchangé (écart en points)");
}

console.log("\n── 3b. Enregistrement d'un objectif vidé (vérification 3 en boutique) ──");
{
  const { saveSettings } = await import("../app/lib/settings.server.js");
  const sent = [];
  const fake = { from: (t) => ({ upsert: (row) => { sent.push({ t, row }); return Promise.resolve({ error: null }); } }) };
  const form = new FormData();
  form.set("intent", "save_goals"); form.set("profitability_threshold_pct", ""); form.set("target_margin_after_ads_pct", ""); form.set("main_product_price", "60");
  const { values, errors } = parseFields(FIELDS.goals, form);
  const r = await saveSettings({ supabase: fake, shop: "s.myshopify.com", values });
  const row = sent[0]?.row ?? {};
  ok(Object.keys(errors).length === 0 && r.ok && sent.length === 1 && sent[0].t === "shop_settings", "un seul upsert shop_settings, sans erreur");
  ok("profitability_threshold_pct" in row && row.profitability_threshold_pct === null, `objectif vidé écrit NULL, clé présente (${JSON.stringify(row.profitability_threshold_pct)})`);
  const action = read("app/routes/app.settings.goals.jsx").replace(/\/\/.*$/gm, "");
  const body = action.slice(action.indexOf("export const action"), action.indexOf("export default"));
  ok(/parseFields\(FIELDS\.goals, form\)/.test(body) && /saveSettings\(\{ supabase, shop: session\.shop, values \}\)/.test(body) && !/profitability_threshold_pct/.test(body), "l'action passe les valeurs lues telles quelles (aucune réécriture de l'objectif)");
}

console.log("\n── 4. Outils de migration ──");
{
  const m = read("scripts/d2_4_migrate.mjs");
  ok(/ON_ERROR_STOP=1/.test(m) && /--single-transaction/.test(m), "application et retour arrière en une transaction, arrêt à la première erreur");
  ok(/TARGET/.test(m) && m.includes("ref !== expected || ref === other") && /la base visée ne correspond pas à TARGET/.test(m), "garde-fou : la base visée doit correspondre à TARGET (test ou prod)");
  ok(/purge-check/.test(m) && /seed-test/.test(m) && /TARGET === "test"|TARGET !== "test"/.test(m), "données fictives et contrôle de purge réservés à la base de test");
  ok(!/console\.log\([^)]*(DIRECT_URL|PGPASSWORD|process\.env\.PG)/.test(m), "aucune chaîne de connexion ni mot de passe affiché");
}

console.log(`\n══════════════════════════════════════════════════════════════════\n BILAN LOT 40 (D2-4) : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} assertion(s) en échec`}\n══════════════════════════════════════════════════════════════════`);
process.exit(failures === 0 ? 0 : 1);
