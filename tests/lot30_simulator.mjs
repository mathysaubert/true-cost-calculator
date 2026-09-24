// ════════════════════════════════════════════════════════════════════════════════
//  LOT 30 — Simulateur boutique (S1, T1/T3/T4b/T5) : module pur app/lib/simulator/ sur les
//  fixtures du lot 27. Leviers → moteur, URL ↔ valeurs, exécution (avant / après / écart), fourchette
//  volume ±10 %, horizon mois glissant, pré-chargement depuis une opportunité, scénario rejouable.
//  Pour lancer : node tests/lot30_simulator.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { LEVERS, RESULT_NODES, deltaTone, leverAvailable, econLevers, econOverrides, valuesFromEconLevers, parseScenario, scenarioSearch, runScenario, scenarioRecord, simulatorHref } from "../app/lib/simulator/index.js";
import { applyLevers } from "../app/lib/econ/simulate.js";
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
  ok(/name="intent" value="keep"/.test(ui) && /runScenario\(/.test(ui), "calcul client + « Retenir » en POST natif");
  const route = read("app/routes/app.simulator.jsx");
  ok(/runScenario\(/.test(route) && /recordDecision\(/.test(route) && /kind: "simulated"/.test(route), "action : recalcul serveur puis decision_log simulated");
  ok(read("package.json").includes("lot30_simulator"), "lot 30 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 30 (Simulateur S1) : ✓ Tous les tests passent" : ` BILAN LOT 30 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
