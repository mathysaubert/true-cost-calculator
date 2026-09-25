// ════════════════════════════════════════════════════════════════════════════════
//  LOT 30 — Simulateur boutique (S1, T1/T3/T4b/T5) : module pur app/lib/simulator/ sur les
//  fixtures du lot 27. Leviers → moteur, URL ↔ valeurs, exécution (avant / après / écart), fourchette
//  volume ±10 %, horizon mois glissant, pré-chargement depuis une opportunité, scénario rejouable.
//  Pour lancer : node tests/lot30_simulator.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { LEVERS, RESULT_NODES, deltaTone, leverAvailable, econLevers, econOverrides, valuesFromEconLevers, parseScenario, scenarioSearch, runScenario, scenarioRecord, simulatorHref } from "../app/lib/simulator/index.js";
import { applyLevers } from "../app/lib/econ/simulate.js";
import { solveObjective, OBJECTIVE_NODES } from "../app/lib/simulator/objective.js";
import { compareScenarios, parseCompareIds, COMPARE_MAX } from "../app/lib/simulator/compare.js";
import { reviewAt, reviewWindow, observedImpact, observedStatus, dueForReview } from "../app/lib/simulator/observed.js";
import { buildBriefing } from "../app/lib/insights/index.js";
import { dataConfidence } from "../app/lib/confidence.js";
import { CATALOGS } from "../app/locales/index.js";
import { makeShop, WINDOWS } from "./fixtures/i0_shops.mjs";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) <= eps;
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const healthy = makeShop("healthy"), missing = makeShop("missing");
const L = healthy.current.agg.shop.leaves;

console.log("\n── 1. Leviers → moteur ──");
{
  ok(LEVERS.length === 8 && LEVERS.map((l) => l.id).join(",") === "price,basket,volume,returns,cogs,fulfilment,ad_budget,cac", "8 leviers du PDF (prix, panier, volume, retours, coût rendu, fulfilment, budget pub, CAC)");
  ok(JSON.stringify(econLevers({ price: 5, basket: -10, volume: 0, cac: 12 })) === JSON.stringify({ price_factor: 1.05, aov_factor: 0.9, cac: 12 }), "écarts en % → facteurs ; 0 % ignoré ; CAC en valeur");
  const lv = applyLevers(L, { cvr_factor: 1.2 }).inputs;
  const ov = econOverrides({ fulfilment: -20, ad_budget: 50 }, lv);
  ok(close(ov.shipping_cost, lv.shipping_cost * 0.8) && close(ov.packaging_cost, lv.packaging_cost * 0.8) && close(ov.ad_spend, lv.ad_spend * 1.5), "surcharges calculées sur les feuilles déjà transformées (composable avec le volume)");
  ok(leverAvailable(LEVERS.find((l) => l.id === "ad_budget"), L) && !leverAvailable(LEVERS.find((l) => l.id === "ad_budget"), missing.current.agg.shop.leaves) && leverAvailable(LEVERS.find((l) => l.id === "price"), {}), "budget pub indisponible sans dépense pub ; prix toujours disponible");
  ok(JSON.stringify(valuesFromEconLevers({ aov_factor: 1.07, price_factor: 0.95, cac: 18 })) === JSON.stringify({ price: -5, basket: 7, cac: 18 }), "facteurs du moteur → valeurs de l'écran (arrondi 0,1)");
  ok(RESULT_NODES.map((n) => n.id).join(",") === "ca_ht,cm2,cm3,net_result,be_roas" && RESULT_NODES.find((n) => n.id === "be_roas").unit === "ratio", "5 nœuds affichés, BE-ROAS en ratio");
  const be = RESULT_NODES.find((n) => n.id === "be_roas"), cm2n = RESULT_NODES.find((n) => n.id === "cm2");
  ok(be.good === "down" && cm2n.good === "up" && deltaTone(be, -0.13) === "good" && deltaTone(be, 0.2) === "bad" && deltaTone(cm2n, 50) === "good" && deltaTone(cm2n, -50) === "bad" && deltaTone(be, 0) === null && deltaTone(be, null) === null, "sens favorable : BE-ROAS en baisse = bon (comme le CAC), CM2 en hausse = bon, nul / inconnu = sans ton");
}

console.log("\n── 2. URL ↔ scénario ──");
{
  const p = parseScenario(new URLSearchParams("days=30&price=5,5&basket=99&volume=abc&rule=aov_vs_main_price&h=month&foo=1"));
  ok(p.values.price === 5.5 && p.values.basket === 30 && !("volume" in p.values) && p.rule === "aov_vs_main_price" && p.horizon === "month", "virgule acceptée, borné à max, invalide ignoré, règle nettoyée, horizon mois");
  ok(parseScenario(new URLSearchParams("rule=<script>&h=year")).horizon === "period" && parseScenario(new URLSearchParams("rule=<script>&h=year")).rule === "script", "horizon inconnu → période ; règle épurée");
  const s = scenarioSearch({ values: { price: 5.5, basket: 0, cac: 18 }, rule: "cm2_below_target", days: 30, horizon: "month" });
  ok(s === "?days=30&price=5.5&cac=18&rule=cm2_below_target&h=month", `chaîne de requête sans les zéros : ${s}`);
  ok(scenarioSearch({}) === "" && scenarioSearch({ values: { price: 0 } }) === "", "scénario vide → aucune requête");
  const fd = new FormData(); fd.set("price", "3"); fd.set("rule", "x");
  ok(parseScenario(fd).values.price === 3 && parseScenario(fd).rule === "x", "FormData accepté (action « Retenir »)");
}

console.log("\n── 3. Exécution, fourchette, horizon ──");
{
  const r0 = runScenario({ leaves: L, values: {}, periodDays: 30 });
  ok(r0.empty && r0.nodes.every((n) => close(n.before, n.after) && close(n.delta, 0)), "sans levier : après = avant, écart 0, scénario vide");
  const r = runScenario({ leaves: L, values: { basket: 7 }, periodDays: 30 });
  const cm2 = r.nodes.find((n) => n.id === "cm2"), ca = r.nodes.find((n) => n.id === "ca_ht"), be = r.nodes.find((n) => n.id === "be_roas");
  ok(!r.empty && cm2.delta > 0 && ca.delta > 0 && close(ca.after, ca.before * 1.07, 1e-6), "panier +7 % : CA × 1,07, contribution en hausse");
  ok(be.delta < 0 && deltaTone(be, be.delta) === "good" && be.good === "down", `panier +7 % : BE-ROAS baisse (${be.before.toFixed(2)} → ${be.after.toFixed(2)}), écart favorable`);
  ok(cm2.low < cm2.after && cm2.after < cm2.high, `fourchette T5 : bas ${cm2.low.toFixed(0)} < après ${cm2.after.toFixed(0)} < haut ${cm2.high.toFixed(0)} (volume ±10 %)`);
  ok(r.assumptions.some((a) => a.key === "orders_constant_aov") && r.note === "scenario_not_forecast", "hypothèse « commandes constantes » et note « scénario, pas prévision »");
  const m = runScenario({ leaves: L, values: { basket: 7 }, periodDays: 30, horizon: "month" });
  const m15 = runScenario({ leaves: L, values: { basket: 7 }, periodDays: 15, horizon: "month" });
  ok(close(m.nodes.find((n) => n.id === "cm2").after, cm2.after) && close(m15.nodes.find((n) => n.id === "cm2").after, cm2.after * 2) && close(m15.nodes.find((n) => n.id === "be_roas").after, be.after), "horizon mois glissant (T4b) : × 30 / jours sur les montants, jamais sur BE-ROAS");
  const worse = runScenario({ leaves: L, values: { cogs: 10, returns: 50 }, periodDays: 30 });
  ok(worse.nodes.find((n) => n.id === "cm2").delta < 0 && worse.nodes.find((n) => n.id === "net_result").delta < 0 && worse.nodes.find((n) => n.id === "ca_ht").delta < 0, "coût rendu +10 % et retours +50 % : contribution, résultat et CA nets en baisse");
  const vol = runScenario({ leaves: L, values: { volume: 20 }, periodDays: 30 });
  ok(close(vol.nodes.find((n) => n.id === "ca_ht").after, ca.before * 1.2) && vol.assumptions.some((a) => a.key === "sessions_and_ad_spend_constant"), "volume +20 % = conversion à sessions et pub constantes");
  const off = runScenario({ leaves: missing.current.agg.shop.leaves, values: { ad_budget: 50 }, periodDays: 30 });
  ok(off.empty && !("ad_budget" in off.values), "levier indisponible (pas de pub) ignoré : scénario vide");
  const rec = scenarioRecord({ run: r, rule: "aov_vs_main_price", days: 30 });
  ok(rec.rule_id === "aov_vs_main_price" && rec.source === "simulator" && rec.values.basket === 7 && rec.levers.aov_factor === 1.07 && rec.node === "cm2" && rec.range.low < rec.range.high && close(rec.after - rec.before, cm2.delta), "scénario rejouable : règle, source, valeurs, leviers, nœud, fourchette d'écart");
  const p2 = parseScenario(new URLSearchParams(scenarioSearch({ values: rec.values, rule: rec.rule_id, days: rec.days })));
  ok(p2.values.basket === 7 && p2.rule === "aov_vs_main_price", "rejeu : requête → mêmes valeurs");
}

console.log("\n── 4. Pré-chargement depuis l'opportunité ──");
{
  const confidence = dataConfidence({ agg: healthy.current.agg, settings: healthy.settings, sources: { ads: true }, lines: healthy.current.lines });
  const b = buildBriefing({ current: healthy.current.agg, previousPeriods: healthy.previous.map((p) => p.agg), settings: healthy.settings, window: WINDOWS[0], confidence });
  const href = simulatorHref(b.opportunity, { days: 30 });
  const p = parseScenario(new URL(`https://x${href}`).searchParams);
  ok(href.startsWith("/app/simulator?days=30&") && p.rule === b.opportunity.id && Object.keys(p.values).length >= 1, `lien pré-chargé : ${href}`);
  const r = runScenario({ leaves: L, values: p.values, periodDays: 30 });
  ok(close(r.nodes.find((n) => n.id === "cm2").after, b.opportunity.after, 0.5), "le Simulateur retrouve l'après de l'opportunité (même moteur, mêmes leviers)");
  ok(simulatorHref({ id: "cm2_drop", simulation: { levers: {} } }) === "/app/simulator?rule=cm2_drop", "insight sans levier → lien avec la règle seule");
}

console.log("\n── 4b. S2a mode objectif ──");
{
  ok(OBJECTIVE_NODES.join(",") === "ca_ht,cm2,cm3,net_result,be_roas,cm2_pct", "cibles : les 5 nœuds du résultat + CM2 % (W1b)");
  const base = runScenario({ leaves: L, values: {}, periodDays: 30 });
  const cm2Pct0 = (base.nodes.find((n) => n.id === "cm2").after / base.nodes.find((n) => n.id === "ca_ht").after) * 100;
  const r = solveObjective({ leaves: L, periodDays: 30, node: "cm2_pct", target: cm2Pct0 + 3, lever: "price" });
  ok(r.reached && r.value > 0 && Math.abs(r.after - (cm2Pct0 + 3)) < 0.05, `objectif CM2 % +3 pt par le prix : prix ${r.value > 0 ? "+" : ""}${r.value} % → ${r.after?.toFixed(2)} %`);
  const chk = runScenario({ leaves: L, values: { price: r.value }, periodDays: 30 });
  ok(Math.abs((chk.nodes.find((n) => n.id === "cm2").after / chk.nodes.find((n) => n.id === "ca_ht").after) * 100 - r.after) < 1e-9, "la valeur trouvée rejouée dans runScenario redonne l'après annoncé");
  const cm2 = base.nodes.find((n) => n.id === "cm2").after;
  const r2 = solveObjective({ leaves: L, periodDays: 30, node: "cm2", target: cm2 * 1.05, lever: "basket", base: { returns: 10 } });
  ok(r2.reached && r2.value > 0 && Math.abs(r2.after - cm2 * 1.05) < 0.5, `objectif CM2 +5 % par le panier, retours +10 % maintenus : panier +${r2.value} %`);
  const far = solveObjective({ leaves: L, periodDays: 30, node: "cm2", target: cm2 * 10, lever: "price" });
  ok(!far.reached && far.reason === "out_of_range" && far.best && far.min === -30 && far.max === 30 && far.best.value === 30, "cible hors de portée : raison, bornes du levier, meilleur bord");
  const fulf = solveObjective({ leaves: L, periodDays: 30, node: "net_result", target: base.nodes.find((n) => n.id === "net_result").after + 20, lever: "fulfilment" });
  ok(fulf.reached && fulf.value < 0, `levier de surcharge (fulfilment) résolu par la bissection maison : ${fulf.value} %`);
  ok(solveObjective({ leaves: missing.current.agg.shop.leaves, periodDays: 30, node: "cm2", target: 1, lever: "ad_budget" }).reason === "unavailable" && solveObjective({ leaves: L, node: "zzz", target: 1, lever: "price" }).reason === "invalid" && solveObjective({ leaves: L, node: "cm2", target: "x", lever: "price" }).reason === "invalid", "levier indisponible, nœud ou cible invalides → raisons");
  const be = solveObjective({ leaves: L, periodDays: 30, node: "be_roas", target: base.nodes.find((n) => n.id === "be_roas").after * 0.9, lever: "cogs" });
  ok(be.reached && be.value < 0, `BE-ROAS −10 % par le coût produit : coût ${be.value} %`);
  const money = solveObjective({ leaves: L, periodDays: 30, node: "cm3", target: base.nodes.find((n) => n.id === "cm3").after - 50, lever: "cac" });
  ok(money.reached && Number.isInteger(money.value), `levier en valeur (CAC) arrondi à l'unité : ${money.value}`);
  const src = read("app/lib/simulator/objective.js");
  ok(!/findThreshold\(/.test(src) && !/import[^;]*findThreshold/.test(src) && /runScenario\(/.test(src), "bissection maison sur runScenario ; findThreshold du moteur jamais appelé (W2)");
}

console.log("\n── 4c. S2b comparaison ──");
{
  ok(parseCompareIds("abcdef12-1,  zz, abcdef12-1, 0123456789abcdef").join(",") === "abcdef12-1,0123456789abcdef" && parseCompareIds(null).length === 0 && parseCompareIds("a1b2c3d4,b1b2c3d4,c1b2c3d4,d1b2c3d4").length === COMPARE_MAX - 1, "ids de comparaison : nettoyés, dédoublonnés, au plus 2 (+ le courant = 3)");
  const c = compareScenarios({ leaves: L, periodDays: 30, scenarios: [{ id: "current", values: { price: 5 } }, { id: "m1", rule_id: "aov_vs_main_price", values: { basket: 7 } }, { id: "m2", values: {} }, { id: "m3", values: { cogs: 5 } }] });
  ok(c.scenarios.length === 3 && c.nodes.length === 5 && c.nodes[0].cells.length === 3, "au plus 3 scénarios, 5 nœuds, une cellule par scénario");
  const cm2 = c.nodes.find((n) => n.id === "cm2");
  const solo = runScenario({ leaves: L, values: { basket: 7 }, periodDays: 30 }).nodes.find((n) => n.id === "cm2");
  ok(close(cm2.cells[1].after, solo.after) && close(cm2.cells[1].delta, solo.delta) && close(cm2.cells[2].delta, 0) && c.scenarios[2].empty === true, "chaque scénario rejoué sur les mêmes feuilles ; scénario vide → écart 0");
  ok(c.nodes.every((n) => n.cells.every((cell) => cell.low == null || cell.low <= cell.after)), "fourchette portée par chaque cellule");
}

console.log("\n── 4d. S2c résultat observé ──");
{
  ok(reviewAt("2026-09-24T10:00:00.000Z", 30) === "2026-10-24T10:00:00.000Z" && reviewAt("2026-09-24T10:00:00.000Z", 7) === "2026-10-01T10:00:00.000Z" && reviewAt("x", 30) === null, "review_at = decided_at + horizon (W6)");
  const w = reviewWindow({ review_at: "2026-10-24T10:00:00.000Z", horizon_days: 30 });
  ok(w.now instanceof Date && w.now.toISOString() === "2026-10-24T10:00:00.000Z" && w.days === 30 && reviewWindow({ review_at: "2026-10-24T10:00:00.000Z", horizon_days: null }).days === 30, "fenêtre de revue : now = review_at, longueur = horizon (30 par défaut)");
  ok(observedImpact({ afterNodes: { cm2: 1300 }, beforeNodes: { cm2: 1200 }, beforeOrders: 40 }).value === 100 && observedImpact({ afterNodes: { cm2: 1300 }, beforeNodes: { cm2: 1200 }, beforeOrders: 0 }).reason === "no_history" && observedImpact({ afterNodes: { cm2: null }, beforeNodes: { cm2: 1200 }, beforeOrders: 40 }).reason === "no_after", "observé = après − avant ; vide avec raison si l'avant n'a aucune commande (W5)");
  const now = new Date("2026-10-25T00:00:00Z");
  ok(observedStatus({ observed_at: "2026-10-24T10:00:00Z", observed_impact: 95 }, now) === "observed" && observedStatus({ observed_at: "2026-10-24T10:00:00Z", observed_impact: null }, now) === "unobservable" && observedStatus({ review_at: "2026-11-01T00:00:00Z" }, now) === "pending" && observedStatus({ review_at: "2026-10-24T00:00:00Z" }, now) === "due" && observedStatus({}, now) === "none", "états : observé, non observable, en attente, due, aucun");
  ok(dueForReview([{ review_at: "2026-10-24T00:00:00Z" }, { review_at: "2026-11-01T00:00:00Z" }, { review_at: "2026-10-01T00:00:00Z", observed_at: "2026-10-02T00:00:00Z" }], now).length === 1, "dues : review_at passé et jamais observées");
  const server = read("app/lib/decisions.server.js");
  ok(/reviewDueDecisions/.test(server) && /is\("observed_at", null\)/.test(server) && /observed_at: now\.toISOString\(\)/.test(server) && /observed:\$\{obs\.reason\}/.test(server), "serveur : décisions dues seulement, observed_at posé une fois, raison conservée dans note");
  const route = read("app/routes/app.simulator.jsx");
  ok(/background\(reviewDueDecisions\(/.test(route) && /reviewAt\(decidedAt, horizonDays\)/.test(route) && /parseCompareIds\(/.test(route), "route : revue en arrière-plan à l'ouverture (W4a), review_at posé à la décision, comparaison par URL");
  ok(/previousNodes: previous\.shop\.nodes/.test(read("app/lib/overview.server.js")), "loadOverview expose les nœuds de la fenêtre précédente (fenêtre « avant »)");
}

console.log("\n── 5. Catalogues et scans ──");
{
  const en = CATALOGS.en, fr = CATALOGS.fr;
  ok(LEVERS.every((l) => en[`sim.lever.${l.id}.label`] && en[`sim.lever.${l.id}.help`] && fr[`sim.lever.${l.id}.label`]), "chaque levier a libellé + aide en/fr");
  ok(RESULT_NODES.every((n) => en[`overview.calc.input.${n.id}`] || en[`sim.node.${n.id}`]), "chaque nœud affiché a un libellé");
  const pure = read("app/lib/simulator/levers.js") + read("app/lib/simulator/scenario.js") + read("app/lib/simulator/index.js");
  ok(!/supabase|fetch\(|import\s+.*react|Date\.now\(|new Date\(|Math\.random/i.test(pure), "module pur : aucune I/O, aucun React, aucune date, aucun aléa");
  ok(!/engine\.js/.test(pure) && /econ\/simulate\.js/.test(pure), "lit econ/simulate.js, jamais engine.js");
  const ui = read("app/components/simulator/Simulator.jsx");
  ok(/<input type="range"/.test(ui) && /<input type="number"/.test(ui) && !/<s-text-field|<s-select|<s-number-field/.test(ui) && /useState/.test(ui), "T3 : champs HTML natifs tenus par React, aucun champ Polaris contrôlé");
  ok(/solveObjective\(/.test(ui) && /compareScenarios\(/.test(ui) && /observedStatus\(/.test(ui) && /data-compare-toggle/.test(ui), "S2 : objectif, comparaison et statut observé branchés dans le composant");
  ok(["reached", "out_of_range", "unavailable"].every((k) => CATALOGS.en[`sim.objective.${k}`] && CATALOGS.fr[`sim.objective.${k}`]) && ["observed", "unobservable", "pending", "due", "expected"].every((k) => CATALOGS.fr[`sim.memory.${k}`]) && /période courante/.test(CATALOGS.fr["sim.compare.note"]), "catalogues S2 : objectif, mémoire observée, mention « recalculé sur la période courante » (W3)");
  ok(/name="intent" value="keep"/.test(ui) && /runScenario\(/.test(ui), "calcul client + « Retenir » en POST natif");
  const route = read("app/routes/app.simulator.jsx");
  ok(/runScenario\(/.test(route) && /recordDecision\(/.test(route) && /kind: "simulated"/.test(route), "action : recalcul serveur puis decision_log simulated");
  ok(read("package.json").includes("lot30_simulator"), "lot 30 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 30 (Simulateur S1) : ✓ Tous les tests passent" : ` BILAN LOT 30 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
