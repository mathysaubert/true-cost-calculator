// ════════════════════════════════════════════════════════════════════════════════
//  LOT 28 — Mémoire des décisions (I0-C, D7a) : module pur app/lib/decisions.js sur les fixtures
//  du lot 27. Lignes insight_log (priorités + opportunité), empreintes, scénario, règles de données
//  résolues, lignes decision_log validées, scan statique (aucune I/O, aucune phrase, kinds = SQL).
//  Pour lancer : node tests/lot28_decisions.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { insightLogRows, opportunityFingerprint, scenarioFromOpportunity, resolvedDataRules, decisionRow, simulatedDecision, dataFixedDecision } from "../app/lib/decisions.js";
import { DECISION_KINDS, I0_TABLES, ALL_TABLES, PURGE_TABLES } from "../app/lib/schema.js";
import { buildBriefing } from "../app/lib/insights/index.js";
import { dataConfidence } from "../app/lib/confidence.js";
import { makeShop, PROFILE_IDS, WINDOWS } from "./fixtures/i0_shops.mjs";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

const shops = Object.fromEntries(PROFILE_IDS.map((p) => [p, makeShop(p)]));
const sourcesOf = (agg) => ({ ads: (agg.shop.leaves.ad_spend ?? 0) > 0, sessions: false, customers: false });
const briefingOf = (shop) => {
  const confidence = dataConfidence({ agg: shop.current.agg, settings: shop.settings, sources: sourcesOf(shop.current.agg), lines: shop.current.lines });
  return { confidence, briefing: buildBriefing({ current: shop.current.agg, previousPeriods: shop.previous.map((p) => p.agg), settings: shop.settings, window: WINDOWS[0], confidence }) };
};
const W = WINDOWS[0];

console.log("\n── 1. insight_log : priorités + opportunité ──");
{
  const { briefing, confidence } = briefingOf(shops.declining);
  const rows = insightLogRows({ briefing, window: W, currency: "EUR", confidenceScore: confidence.score });
  ok(rows.length === briefing.priorities.length + (briefing.opportunity ? 1 : 0), `en baisse : ${rows.length} lignes = ${briefing.priorities.length} priorités + ${briefing.opportunity ? 1 : 0} opportunité`);
  ok(rows.filter((r) => r.rank >= 1).every((r, i) => r.rank === briefing.priorities[i].rank && r.fingerprint === briefing.priorities[i].fingerprint), "rangs 1-3 et empreintes = celles du briefing");
  ok(rows.every((r) => r.window_start === W.start && r.window_end === W.end && r.currency_code === "EUR"), "fenêtre et devise portées par chaque ligne");
  ok(rows.every((r) => typeof r.payload === "object" && r.payload.confidence_score === confidence.score && Array.isArray(r.payload.evidence)), "payload : preuves + score de fiabilité au moment de l'affichage");
  const withImpact = rows.filter((r) => r.impact_low != null);
  ok(withImpact.length > 0 && withImpact.every((r) => Number.isInteger(Math.round(r.impact_low * 100)) && r.impact_low <= r.impact_high), "impacts arrondis au centime, low ≤ high");
  const flat = JSON.stringify(rows);
  ok(!/@|customer|email|first_name|shopOwnerName/i.test(flat), "rien de nominatif dans les lignes");
  ok(new Set(rows.map((r) => r.fingerprint)).size === rows.length, "empreintes distinctes");
}
{
  const { briefing, confidence } = briefingOf(shops.healthy);
  const rows = insightLogRows({ briefing, window: W, currency: "EUR", confidenceScore: confidence.score });
  const opp = rows.find((r) => r.rank === 0);
  ok(briefing.opportunity && opp && opp.status === "simulation" && opp.rule_id === briefing.opportunity.id, "saine : opportunité enregistrée au rang 0, statut simulation");
  ok(opp && opp.fingerprint === opportunityFingerprint(briefing.opportunity, W) && opp.fingerprint.startsWith(`${briefing.opportunity.id}:opportunity:shop:${W.start}:${W.end}:`), "empreinte de l'opportunité : règle + sujet + fenêtre + impact arrondi");
  const sc = scenarioFromOpportunity(briefing.opportunity);
  ok(sc.node === briefing.opportunity.node && sc.before != null && sc.after > sc.before && Object.keys(sc.levers).length >= 1 && sc.assumptions.length >= 1, "scénario : nœud, avant < après, leviers, hypothèses");
  ok(opportunityFingerprint(briefing.opportunity, W) !== opportunityFingerprint(briefing.opportunity, WINDOWS[1]), "une autre fenêtre → une autre empreinte (une ligne par jour affiché)");
  ok(insightLogRows({ briefing: null }).length === 0 && insightLogRows({ briefing: { priorities: [], opportunity: null } }).length === 0, "sans briefing ni priorité → aucune ligne");
}

console.log("\n── 2. Règles de données résolues ──");
{
  const { briefing, confidence } = briefingOf(shops.missing);
  const dataIds = briefing.insights.filter((i) => i.kind === "data").map((i) => i.id);
  ok(dataIds.includes("cost_coverage") && dataIds.includes("fees_unconfirmed"), `manquante : règles de données actives (${dataIds.join(", ")})`);
  const open = [
    { rule_id: "cost_coverage", fingerprint: "cost_coverage:shop:shop:a:b:na", payload: { confidence_score: 30 } },
    { rule_id: "cost_coverage", fingerprint: "cost_coverage:shop:shop:c:d:na", payload: { confidence_score: 35 } },
    { rule_id: "no_ad_source", fingerprint: "no_ad_source:shop:shop:a:b:na", payload: { confidence_score: 30 } },
  ];
  const stillOpen = resolvedDataRules({ open, insights: briefing.insights });
  ok(stillOpen.every((r) => r.rule_id !== "cost_coverage"), "une règle encore détectée n'est pas résolue");
  const healthy = briefingOf(shops.healthy).briefing;
  const resolved = resolvedDataRules({ open, insights: healthy.insights });
  const cc = resolved.find((r) => r.rule_id === "cost_coverage");
  ok(resolved.length === 2 && cc && cc.fingerprints.length === 2 && cc.score_before === 30, "règles disparues → une résolution par règle, empreintes groupées, score le plus bas conservé");
  const d = dataFixedDecision({ shop: "x.myshopify.com", resolved: cc, scoreAfter: 100 });
  ok(d.kind === "data_fixed" && d.scenario.score_before === 30 && d.scenario.score_after === 100 && d.insight_fingerprint === cc.fingerprints[0], "decision_log data_fixed : score avant / après, empreinte d'origine");
  ok(resolvedDataRules({ open: [], insights: healthy.insights }).length === 0, "aucune ligne ouverte → rien");
  void confidence;
}

console.log("\n── 3. decision_log : validation ──");
{
  const { briefing } = briefingOf(shops.healthy);
  const s = simulatedDecision({ shop: "x.myshopify.com", opportunity: briefing.opportunity, window: W });
  ok(s.kind === "simulated" && s.horizon_days === 30 && s.expected_node === briefing.opportunity.node && s.expected_impact_low <= s.expected_impact_high && s.insight_fingerprint === opportunityFingerprint(briefing.opportunity, W), "scénario retenu : horizon 30 j, nœud, fourchette, empreinte de l'opportunité");
  ok(s.scenario.levers && s.scenario.before != null, "le scénario rejouable est conservé");
  let threw = false; try { decisionRow({ shop: "x", kind: "guessed" }); } catch { threw = true; }
  ok(threw, "kind inconnu → erreur (jamais d'écriture floue)");
  threw = false; try { decisionRow({ kind: "accepted" }); } catch { threw = true; }
  ok(threw, "boutique manquante → erreur");
  ok(DECISION_KINDS.every((k) => decisionRow({ shop: "x", kind: k }).kind === k), `les ${DECISION_KINDS.length} kinds passent`);
}

console.log("\n── 4. Contrat de schéma et scans ──");
{
  const sql = read("supabase/migrations/20260924_i0_01_decision_memory.sql");
  const check = sql.match(/kind\s+TEXT\s+NOT NULL CHECK \(kind IN \(([^)]*)\)\)/);
  const sqlKinds = check ? [...check[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
  ok(sqlKinds.length === DECISION_KINDS.length && DECISION_KINDS.every((k) => sqlKinds.includes(k)), `CHECK SQL de decision_log.kind = DECISION_KINDS (${sqlKinds.join(", ")})`);
  ok(I0_TABLES.join(",") === "insight_log,decision_log" && I0_TABLES.every((t) => ALL_TABLES.includes(t) && PURGE_TABLES.includes(t)), "I0_TABLES dans ALL_TABLES et PURGE_TABLES");
  const pure = read("app/lib/decisions.js");
  ok(!/supabase|fetch\(|import\s+.*react|Date\.now\(|Math\.random/i.test(pure), "decisions.js : aucune I/O, aucun React, aucun aléa");
  const sentences = [...pure.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).filter((t) => (t.match(/[A-Za-zÀ-ÿ]{3,}/g) ?? []).length >= 4 && /\s/.test(t) && !/decision_log|insight_log/.test(t));
  ok(sentences.length === 0, `aucune phrase en dur${sentences.length ? " — " + sentences.join(" | ") : ""}`);
  const server = read("app/lib/decisions.server.js");
  ok(/supabase\.rpc\("record_insights"/.test(server) && /console\.warn/.test(server) && !/throw /.test(server), "serveur : RPC record_insights, erreurs journalisées, jamais propagées");
  const route = read("app/routes/app.overview.jsx");
  ok(/background\(recordShownInsights\(/.test(route) && /intent === "simulate"/.test(route), "loader : enregistrement en arrière-plan ; action : intent simulate");
  ok(read("package.json").includes("lot28_decisions"), "lot 28 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 28 (mémoire des décisions I0-C) : ✓ Tous les tests passent" : ` BILAN LOT 28 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
