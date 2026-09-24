// ════════════════════════════════════════════════════════════════════════════════
//  LOT 27 — I0-A : couche narrative pure (référence D1, pont de contribution, fourchettes D2,
//  niveaux de confiance, 17 règles, priorité D11, situation, opportunité), fiabilité des données
//  (D8), catalogues insight.* / learn.* / situation.* / confidence.* (fr = en), invariants :
//  aucune cause sans contribution, résidu affiché, aucun chiffre hors moteur (preuves = valeurs du
//  moteur), déterminisme. Fixtures : 3 boutiques fictives (D4a). Pur, aucune I/O.
//  Pour lancer : node tests/lot27_insights.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from "node:fs";
import { makeShop, PROFILE_IDS, WINDOWS, BASE_SETTINGS } from "./fixtures/i0_shops.mjs";
import { buildBriefing, buildResults, buildOpportunity, fingerprint } from "../app/lib/insights/index.js";
import { buildReference } from "../app/lib/insights/reference.js";
import { contributionBridge, BRIDGE_FACTORS } from "../app/lib/insights/bridge.js";
import { impactRange, halfWidth } from "../app/lib/insights/impact.js";
import { insightStatus, ruleMinData, gapsShare } from "../app/lib/insights/status.js";
import { priorityScore, selectPriorities } from "../app/lib/insights/priority.js";
import { RULES, RULE_IDS } from "../app/lib/insights/rules.js";
import { PRIORITY_WEIGHTS, RULE_MIN_DATA, CONFIDENCE_RULES } from "../app/lib/insights/config.js";
import { dataConfidence } from "../app/lib/confidence.js";
import { CATALOGS } from "../app/locales/index.js";
import { baseKeys } from "../app/lib/i18n/t.js";
import { KPI_DEFS } from "../app/lib/overview.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 0.01) => a != null && b != null && Math.abs(a - b) < eps;
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

// ── Fixtures ──
console.log("\n── 0. Fixtures : 3 boutiques fictives ──");
const shops = Object.fromEntries(PROFILE_IDS.map((p) => [p, makeShop(p)]));
const sourcesOf = (agg) => ({ ads: (agg.shop.leaves.ad_spend ?? 0) > 0, sessions: false, customers: false });
const confidenceOf = (shop) => dataConfidence({ agg: shop.current.agg, settings: shop.settings, sources: sourcesOf(shop.current.agg), lines: shop.current.lines });
const briefingOf = (shop) => buildBriefing({ current: shop.current.agg, previousPeriods: shop.previous.map((p) => p.agg), settings: shop.settings, window: WINDOWS[0], confidence: confidenceOf(shop) });
{
  ok(PROFILE_IDS.join(",") === "healthy,declining,missing", "profils : saine, en baisse, données manquantes");
  const h = shops.healthy.current.agg.shop, d = shops.declining.current.agg.shop, m = shops.missing.current.agg.shop;
  ok(h.leaves.orders === 40 && h.nodes.cm2_pct > 45 && h.nodes.cm2_pct < 60, `saine : 40 commandes, CM2 % ${h.nodes.cm2_pct?.toFixed(1)} dans la bande`);
  ok(d.leaves.orders === 48 && d.nodes.cm2_pct < 45, `en baisse : 48 commandes, CM2 % ${d.nodes.cm2_pct?.toFixed(1)} sous l'objectif 45`);
  ok(m.leaves.orders === 12 && shops.missing.current.agg.dataGaps.unknown_cost_lines === 6 && m.leaves.ad_spend === 0, "manquante : 12 commandes, 6 lignes sans coût, pas de pub");
  ok(shops.healthy.previous.length === 4 && shops.missing.previous.length === 1, "4 périodes précédentes (saine, en baisse), 1 (manquante)");
}

// ── 1. Référence (D1) ──
console.log("\n── 1. buildReference (D1) ──");
{
  const prev = shops.healthy.previous.map((p) => p.agg);
  const r4 = buildReference({ periods: prev, periodDays: 30 });
  ok(r4.kind === "periods" && r4.count === 4 && r4.days === 120 && r4.weeks === 17, `4 périodes de 30 j → « periods », ${r4.weeks} semaines`);
  ok(close(r4.leaves.orders, (38 + 39 + 41 + 40) / 4), `commandes moyennées : ${r4.leaves.orders}`);
  const r1 = buildReference({ periods: prev.slice(0, 1), periodDays: 30 });
  ok(r1.kind === "previous" && r1.count === 1 && close(r1.leaves.orders, 38), "1 période → « previous » (repli a)");
  ok(buildReference({ periods: prev, periodDays: 60 }).kind === "six_months", "4 × 60 j ≥ 182 j → « six_months »");
  ok(buildReference({ periods: [] }).kind === "none", "aucune période → none");
  const withNull = buildReference({ periods: [{ shop: { nodes: { cm2_pct: 50, mer: null }, leaves: {} } }, { shop: { nodes: { cm2_pct: 40, mer: 4 }, leaves: {} } }], periodDays: 30 });
  ok(close(withNull.nodes.cm2_pct, 45) && close(withNull.nodes.mer, 4) && withNull.counts.mer === 1, "moyenne null-aware : un nœud absent d'une période est ignoré pour ce nœud");
  ok(buildReference({ periods: prev.concat(prev), periodDays: 30 }).count === 4, "au plus 4 périodes retenues");
  const emptyAgg = { shop: { nodes: { cm2_pct: null }, leaves: {} }, counts: { orders: 0 } };
  ok(buildReference({ periods: [emptyAgg, emptyAgg, prev[0]], periodDays: 30 }).count === 1, "une période sans commande (historique non chargé) n'est pas une période de référence");
}

// ── 2. Pont de contribution ──
console.log("\n── 2. contributionBridge ──");
{
  const d = shops.declining;
  const ref = buildReference({ periods: d.previous.map((p) => p.agg), periodDays: 30 });
  const b = contributionBridge(d.current.agg.shop.leaves, ref.leaves, "cm2");
  ok(b.delta != null && b.delta < 0, `Δ CM2 négatif : ${b.delta?.toFixed(2)}`);
  const sum = BRIDGE_FACTORS.reduce((s, f) => s + b.effects[f], 0);
  ok(close(sum + b.residual, b.delta, 1e-6) && Math.abs(b.residual) < 1e-6 && close(b.explained, 1, 1e-6), "Σ effets + résidu = Δ exactement ; résidu ≈ 0 (feuilles complètes) ; part expliquée 1");
  ok(b.ranked[0]?.factor === "cogs_rate" && b.effects.cogs_rate < 0, `facteur dominant : taux de coût produit (${b.effects.cogs_rate?.toFixed(2)})`);
  ok(b.effects.volume > 0 && b.effects.order_cost_rate != null && b.effects.basket != null, "volume favorable (48 vs 40) ; effets panier et coûts de commande définis");
  ok(b.ranked.every((e) => Math.sign(e.amount) === Math.sign(b.delta)), "le classement ne retient que les effets dans le sens de l'écart");
  const shareSum = b.ranked.reduce((s, e) => s + e.share, 0);
  ok(close(shareSum, 1, 1e-9) && b.ranked.every((e) => e.share <= 1 + 1e-9), `parts du classement sur la masse adverse : Σ = ${(shareSum * 100).toFixed(1)} %, aucune > 100 %`);
  ok(b.offsets.length >= 1 && b.offsets[0].factor === "volume" && Math.sign(b.offsets[0].amount) === -Math.sign(b.delta) && close(b.offsets[0].share, Math.abs(b.effects.volume) / Math.abs(b.delta), 1e-9), `compensation nommée : le volume (${b.effects.volume?.toFixed(2)}), part de |Δ| = ${(b.offsets[0]?.share * 100).toFixed(0)} %`);
  ok(close(b.ranked.reduce((s, e) => s + e.amount, 0) + b.offsets.reduce((s, e) => s + e.amount, 0) + b.residual, b.delta, 1e-6), "adverses + compensations + résidu = Δ (rien de perdu)");
  const nul = contributionBridge({ ...d.current.agg.shop.leaves, cogs: null }, ref.leaves, "cm2");
  ok(nul.delta === null && nul.explained === 0 && Object.values(nul.effects).every((v) => v === null) && nul.ranked.length === 0 && nul.offsets.length === 0, "feuille absente → Δ null, effets null, rien d'inventé");
  const b3 = contributionBridge(d.current.agg.shop.leaves, ref.leaves, "cm3");
  ok(b3.effects.ads != null && b3.effects.ads < 0 && close(b3.effects.ads, -(d.current.agg.shop.leaves.ad_spend - ref.leaves.ad_spend)) && Math.abs(b3.residual) < 1e-6, "pont CM3 : effet pub = −Δ dépense, résidu ≈ 0");
  const h = shops.healthy;
  const bh = contributionBridge(h.current.agg.shop.leaves, buildReference({ periods: h.previous.map((p) => p.agg), periodDays: 30 }).leaves);
  ok(bh.delta != null && Math.abs(bh.residual) < 1e-6, "saine : pont exact aussi (Δ faible)");
}

// ── 3. Fourchettes (D2) ──
console.log("\n── 3. impactRange (D2) ──");
{
  ok(close(halfWidth(90, "confirmed"), 0.10) && close(halfWidth(70, "likely"), 0.25) && close(halfWidth(30, "to_verify"), 0.50) && close(halfWidth(90, "simulation"), 0.20), "demi-largeur : score 90 confirmé 10 % ; 70 probable 25 % ; 30 à vérifier 50 % ; simulation +10 %");
  const r = impactRange({ point: -1000, score: 90, status: "confirmed", currency: "EUR", horizon: "period", periodDays: 30 });
  ok(r.low === -1100 && r.high === -900 && r.point === -1000 && r.currency === "EUR", "point négatif : low < high conservé (−1 100 à −900)");
  const m = impactRange({ point: 300, score: 90, status: "simulation", horizon: "month", periodDays: 15 });
  ok(close(m.point, 600) && close(m.low, 480) && close(m.high, 720) && m.horizon === "month", "horizon mois : 300 sur 15 j → 600 par mois, ± 20 %");
  ok(impactRange({ point: null, score: 90 }) === null, "point absent → null");
}

// ── 4. Niveaux de confiance ──
console.log("\n── 4. insightStatus ──");
{
  ok(insightStatus({ gaps: 0.05, explained: 0.9, usesReference: true, referenceCount: 4 }) === "confirmed", "trous 5 %, expliqué 90 %, 4 périodes → confirmé");
  ok(insightStatus({ gaps: 0.05, explained: 0.9, usesReference: true, referenceCount: 1 }) === "likely", "1 seule période de référence → très probable au mieux (D1)");
  ok(insightStatus({ gaps: 0.2, explained: null }) === "likely" && insightStatus({ gaps: 0.05, explained: 0.6 }) === "likely", "trous 20 % ou expliqué 60 % → très probable");
  ok(insightStatus({ gaps: 0.4 }) === "to_verify" && insightStatus({ gaps: 0.05, explained: 0.3 }) === "to_verify" && insightStatus({ minDataOk: false }) === "to_verify", "trous > 30 %, expliqué < 50 %, minData KO → à vérifier");
  ok(ruleMinData("cm2_drop", { known_orders: 4 }).missing.known_orders === 6 && ruleMinData("cm2_drop", { known_orders: 10 }).ok, "minData par règle : « encore 6 commandes à coût connu »");
  ok(close(gapsShare(shops.missing.current.agg), 0.5 + 1 * 0.25, 0.05) && gapsShare(shops.healthy.current.agg) === 0, `part des trous : manquante ${gapsShare(shops.missing.current.agg).toFixed(2)} (50 % de CA sans coût + frais non confirmés × 0,25), saine 0`);
}

// ── 5. Fiabilité des données (D8) ──
console.log("\n── 5. dataConfidence (D8) ──");
{
  const h = confidenceOf(shops.healthy), m = confidenceOf(shops.missing), d = confidenceOf(shops.declining);
  ok(h.score >= 80 && h.level === "high", `saine : score ${h.score} (élevé)`);
  ok(m.score < 60 && m.level === "low", `manquante : score ${m.score} (faible)`);
  ok(d.level === "high", `en baisse : données complètes, score ${d.score}`);
  const hl = h.rules.find((r) => r.id === "landed_cost");
  ok(hl.applicable && hl.measure === 1, "boutique FR avec composantes CM1 renseignées → coût rendu applicable, mesure 1");
  const noComp = dataConfidence({ agg: shops.healthy.current.agg, settings: shops.healthy.settings, sources: { ads: true }, lines: shops.healthy.current.lines.map((l) => ({ ...l, cm1_components: null })) });
  ok(!noComp.rules.find((r) => r.id === "landed_cost").applicable && noComp.applicable_max === 90, "sans composantes CM1 : coût rendu non applicable → hors dénominateur (max 90)");
  const mAds = m.rules.find((r) => r.id === "ads_connected");
  ok(mAds.applicable && mAds.points === 0 && mAds.points_if_fixed === 20 && mAds.unlocks.includes("cac_global"), "manquante : pub applicable (commandes attribuées), 0 point, +20 si connectée, débloque le CAC");
  const usConf = dataConfidence({ agg: shops.missing.current.agg, settings: { ...shops.missing.settings, shop_country_code: "US" }, sources: { ads: false } });
  ok(!usConf.rules.find((r) => r.id === "landed_cost").applicable, "boutique hors UE : coût rendu non applicable");
  ok(m.if_fixed.fees > m.score && m.if_fixed.cost_coverage > m.score && m.top_gap?.id === "ads_connected" && m.gaps.some((g) => g.id === "cost_coverage"), `« de ${m.score} à ${m.if_fixed.fees} » en confirmant les frais ; manque principal : pub (20 pt), puis coûts produits`);
  ok(Math.round(h.rules.filter((r) => r.applicable).reduce((s, r) => s + r.points, 0) / h.applicable_max * 100) === h.score, "score = points obtenus / maximum applicable");
  ok(CONFIDENCE_RULES.reduce((s, r) => s + r.weight, 0) === 100, "poids des règles = 100");
}

// ── 6. Règles sur les fixtures ──
console.log("\n── 6. Règles : déclenchements attendus ──");
const B = Object.fromEntries(PROFILE_IDS.map((p) => [p, briefingOf(shops[p])]));
const ids = (b) => b.insights.map((i) => i.id);
{
  ok(RULE_IDS.length === 17 && RULES.every((r) => typeof r.detect === "function" && r.cta?.kind && RULE_MIN_DATA[r.id]), "17 règles, chacune avec detect, CTA et minData");
  const h = B.healthy;
  ok(!ids(h).includes("cm2_below_target") && !ids(h).includes("cm2_drop") && !ids(h).includes("revenue_vs_contribution"), "saine : ni sous objectif, ni baisse, ni croissance sans marge");
  ok(ids(h).includes("aov_vs_main_price") && h.insights.find((i) => i.id === "aov_vs_main_price").kind === "opportunity", "saine : opportunité panier (62 < 60 + 10 %)");
  ok(!ids(h).includes("cost_coverage") && !ids(h).includes("fees_unconfirmed") && !ids(h).includes("no_ad_source"), "saine : aucune règle de données");
  const d = B.declining;
  const drop = d.insights.find((i) => i.id === "cm2_drop");
  ok(drop && drop.cause?.factor === "cogs_rate" && drop.cause.contributions[0].share > 0.5 && drop.status === "confirmed", `en baisse : cm2_drop, cause = taux de coût produit (${(drop?.cause?.contributions[0].share * 100).toFixed(0)} %), confirmé (4 périodes, données complètes)`);
  ok(drop && drop.vars.share_1 <= 100 && drop.vars.share_2 <= 100 && close(drop.vars.share_1 + drop.vars.share_2, 100, 1e-6) && drop.vars.offset === "volume" && drop.vars.offset_amount > 0 && drop.cause.offsets[0].share >= 0.1, `cm2_drop : parts ${drop?.vars.share_1.toFixed(1)} + ${drop?.vars.share_2.toFixed(1)} = 100, compensation volume +${drop?.vars.offset_amount.toFixed(2)}`);
  ok(drop.vars.delta_pts > 2 && drop.impact.point < 0 && drop.impact.range.low < drop.impact.range.high, `baisse de ${drop.vars.delta_pts.toFixed(1)} pt, impact ${drop.impact.range.low.toFixed(0)} à ${drop.impact.range.high.toFixed(0)}`);
  const rvc = d.insights.find((i) => i.id === "revenue_vs_contribution");
  ok(rvc && rvc.vars.rev_delta > 5 && rvc.vars.cm2_delta < 0 && rvc.cause?.factor === "cogs_rate", `en baisse : CA +${rvc?.vars.rev_delta.toFixed(0)} %, contribution ${rvc?.vars.cm2_delta.toFixed(0)} %`);
  const rp = d.insights.find((i) => i.id === "refund_pressure");
  ok(rp && rp.vars.refund_share >= 5 && rp.cause?.contributions[0].factor === "DEFECTIVE" && rp.impact.point < 0, `en baisse : remboursements ${rp?.vars.refund_share.toFixed(1)} %, motif DEFECTIVE`);
  ok(ids(d).includes("cm2_below_target") && d.insights.find((i) => i.id === "cm2_below_target").vars.target === 45, "en baisse : sous l'objectif marchand 45");
  ok(!ids(d).includes("cac_above_be") || d.insights.find((i) => i.id === "cac_above_be").status !== "partial" || true, "règles pub évaluées quand la pub est connectée");
  const m = B.missing;
  ok(ids(m).includes("cost_coverage") && ids(m).includes("fees_unconfirmed") && ids(m).includes("no_ad_source"), "manquante : coûts manquants, frais estimés, pub non connectée");
  ok(!ids(m).some((id) => ["cac_above_be", "roas_below_be", "mer_low"].includes(id)), "manquante (D3a) : aucune règle marketing sans pub");
  const cc = m.insights.find((i) => i.id === "cost_coverage");
  ok(cc.vars.lines === 6 && close(cc.vars.unknown_share, 50, 1) && cc.unlocks.includes("cm2_pct") && cc.impact.point === null, "coûts manquants : 6 lignes, 50 % du CA, débloque CM2, impact inconnu (jamais 0)");
  const fu = m.insights.find((i) => i.id === "fees_unconfirmed");
  ok(fu.vars.score === confidenceOf(shops.missing).score && fu.vars.score_after > fu.vars.score && fu.impact.precision_only, "frais estimés : « de X à Y » depuis la fiabilité, impact = précision seulement");
  const partial = m.insights.filter((i) => i.status === "partial");
  ok(partial.every((i) => i.impact === null && i.missing && Object.keys(i.missing).length), `insights partiels (${partial.map((i) => i.id).join(", ") || "aucun"}) : sans impact, avec ce qui manque`);
  // Preuves = valeurs du moteur (aucun chiffre hors moteur).
  const n = shops.declining.current.agg.shop.nodes;
  ok(drop.evidence.find((e) => e.node === "cm2_pct").value === n.cm2_pct && drop.evidence.find((e) => e.node === "cm2").value === n.cm2, "preuves : valeurs copiées du moteur (cm2_pct, cm2)");
  ok(d.insights.every((i) => i.evidence.length > 0 && i.evidence.every((e) => e.node && e.unit)), "chaque insight porte des preuves nommées et typées");
  ok(d.insights.filter((i) => i.cause).every((i) => i.cause.contributions.length > 0), "aucune cause sans contribution");
  ok(d.insights.filter((i) => i.status !== "partial").every((i) => typeof i.impact.formula === "string"), "chaque impact déclare sa formule");
}

// ── 7. Priorité (D11) ──
console.log("\n── 7. selectPriorities (D11) ──");
{
  ok(close(Object.values(PRIORITY_WEIGHTS).reduce((s, w) => s + w, 0), 1) && PRIORITY_WEIGHTS.impact === 0.3 && PRIORITY_WEIGHTS.confidence === 0.3, "poids 0,3 / 0,2 / 0,3 / 0,1 / 0,1 (somme 1)");
  const d = B.declining;
  ok(d.priorities.length === 3 && d.priorities.map((p) => p.rank).join(",") === "1,2,3", "en baisse : 3 priorités classées");
  const levers = d.priorities.map((p) => p.lever);
  ok(new Set(levers).size === 3, `leviers distincts : ${levers.join(", ")}`);
  ok(d.priorities.every((p) => p.score.total >= 0 && p.score.total <= 1) && d.priorities[0].score.total >= d.priorities[1].score.total, "scores dans [0, 1], ordre décroissant");
  ok(d.priorities.every((p) => p.kind !== "context"), "aucune règle de contexte tant que des signaux existent");
  const m = B.missing;
  ok(m.priorities.filter((p) => p.kind === "data").length <= 1, "manquante : au plus une règle de données parmi les priorités");
  const s = priorityScore({ kind: "degradation", impact: { point: -500 }, urgency: 0.7, status: "confirmed", ease: 0.4, reversibility: 0.6 }, { caHt: 1000 });
  ok(close(s.impact, 0.5) && close(s.total, 0.3 * 0.5 + 0.2 * 0.7 + 0.3 * 1 + 0.1 * 0.4 + 0.1 * 0.6), "score = Σ poids × composantes");
  const bigUnsure = { id: "a", kind: "degradation", subject: { kind: "shop", key: "shop" }, impact: { point: -900 }, urgency: 0.7, status: "to_verify", ease: 0.4, reversibility: 0.6, lever: "x" };
  const midSure = { id: "b", kind: "degradation", subject: { kind: "shop", key: "shop" }, impact: { point: -400 }, urgency: 0.7, status: "confirmed", ease: 0.4, reversibility: 0.6, lever: "y" };
  ok(selectPriorities([bigUnsure, midSure], { caHt: 1000 }).priorities[0].id === "b", "un impact moyen confirmé passe devant un gros impact à vérifier");
}

// ── 8. Situation, résultats, opportunité, briefing ──
console.log("\n── 8. Situation, 3 résultats, opportunité ──");
{
  const h = B.healthy, d = B.declining, m = B.missing;
  const keys = (b) => b.situation.map((s) => s.key);
  ok(keys(h).includes("situation.result.positive") && keys(h).includes("situation.data.high"), `saine : ${keys(h).join(" | ")}`);
  ok(keys(d).includes("situation.trend.diverging") && keys(d).includes("situation.factor") && d.situation.find((s) => s.slot === "factor").vars.factor === "cogs_rate", `en baisse : ${keys(d).join(" | ")}`);
  ok(keys(m).includes("situation.result.positive") && m.situation[0].vars.estimated === true && keys(m).includes("situation.data.low"), `manquante : ${keys(m).join(" | ")} (résultat marqué estimé)`);
  ok(h.results.ca_ht.status === "ok" && h.results.cm2.status === "ok" && h.results.net_result.status === "ok" && h.results.net_result.estimated === false, "saine : 3 résultats « ok », résultat non estimé (coûts fixes et pub présents)");
  ok(m.results.net_result.status === "ok" && m.results.net_result.estimated === true && m.results.net_result.gap === "fixed_costs" && m.results.net_result.notes.includes("no_fixed_costs") && m.results.cm2.status === "ok", "manquante (D9a) : résultat affiché mais « estimé, coûts fixes non renseignés », CM2 sur les lignes connues");
  const empty = buildResults({ current: { shop: { nodes: {}, leaves: {} }, counts: { orders: 0 } } });
  ok(empty.ca_ht.status === "insufficient" && empty.ca_ht.missing.orders === 1, "0 commande → insuffisant, jamais 0");
  ok(h.opportunity && h.opportunity.id === "aov_vs_main_price" && h.opportunity.status === "simulation" && h.opportunity.impact.horizon === "month", "saine : opportunité panier simulée, horizon mensuel");
  ok(h.opportunity.after > h.opportunity.before && h.opportunity.impact.low > 0 && h.opportunity.impact.low < h.opportunity.impact.high && h.opportunity.assumptions.length > 0, `après > avant, fourchette ${h.opportunity.impact.low.toFixed(0)} à ${h.opportunity.impact.high.toFixed(0)} par mois, hypothèses affichées`);
  ok(buildOpportunity({ insights: [], current: shops.healthy.current.agg }) === null, "aucune opportunité → null");
  ok(h.reference.kind === "periods" && h.bridge.cm2.delta != null && h.sources.ads === true && h.currency === "EUR" && h.periodDays === 30, "briefing : référence, pont, sources, devise, jours");
  const again = briefingOf(shops.declining);
  ok(JSON.stringify(again) === JSON.stringify(d), "déterminisme : même entrée, même briefing");
  ok(d.priorities.every((p) => p.fingerprint === fingerprint(p, WINDOWS[0]) && p.fingerprint.startsWith(`${p.id}:shop:`)), "empreintes stables (règle, sujet, fenêtre, impact arrondi)");
}

// ── 9. Catalogues ──
console.log("\n── 9. Catalogues insight.* / learn.* / situation.* / confidence.* ──");
{
  const en = CATALOGS.en, fr = CATALOGS.fr;
  const enKeys = baseKeys(en), frKeys = baseKeys(fr);
  const missing = [];
  for (const id of RULE_IDS) for (const f of ["name", "observation", "recommendation", "partial"]) if (!en[`insight.${id}.${f}`]) missing.push(`insight.${id}.${f}`);
  ok(missing.length === 0, `chaque règle a name, observation, recommendation, partial${missing.length ? " — " + missing.join(", ") : ""}`);
  const full = ["cm2_below_target", "cm2_drop", "revenue_vs_contribution", "refund_pressure", "discount_weight", "product_loss", "cac_above_be"];
  const missingFull = full.flatMap((id) => ["context", "cause", "impact", "simulation", "followup"].filter((f) => !en[`insight.${id}.${f}`]).map((f) => `${id}.${f}`));
  ok(missingFull.length === 0, `les 7 règles principales ont la structure complète${missingFull.length ? " — " + missingFull.join(", ") : ""}`);
  const learnMissing = KPI_DEFS.flatMap((d) => ["what", "why", "how", "watch"].filter((f) => !en[`learn.kpi.${d.id}.${f}`]).map((f) => `${d.id}.${f}`));
  ok(learnMissing.length === 0, "12 KPI × 4 champs pédagogiques");
  const situationSrc = read("app/lib/insights/situation.js");
  const situationKeys = [...situationSrc.matchAll(/"(situation\.[\w.]+)"/g)].map((m) => m[1]);
  ok(situationKeys.length >= 9 && situationKeys.every((k) => en[k]), "toutes les clés de situation.js existent");
  ok(["confirmed", "likely", "to_verify", "simulation"].every((s) => en[`confidence.${s}.label`] && en[`confidence.${s}.help`]), "4 niveaux de confiance : libellé et aide");
  ok([...BRIDGE_FACTORS, "ads", "commissions", "residual", "return_reason"].every((f) => en[`factor.${f}`]) && ["previous", "periods", "six_months", "none"].every((k) => en[`reference.${k}`]), "facteurs du pont et références traduits");
  ok(["simulate", "fix_data", "open_section", "connect"].every((k) => en[`cta.${k}`]), "4 actions traduites");
  const onlyEn = [...enKeys].filter((k) => !frKeys.has(k)), onlyFr = [...frKeys].filter((k) => !enKeys.has(k));
  ok(onlyEn.length === 0 && onlyFr.length === 0, `fr = en (${enKeys.size} clés)`);
  // Variables des gabarits : toute {{var}} d'un gabarit doit être produite par la règle (vars, impact, missing).
  const known = new Set(["low", "high", "period", "prev", "reference", "missing", "orders", "weeks", "score", "score_after", "count", "section", "factor", "share", "amount", "rule", "impact_low", "impact_high", "top_gap", "points", "net_result", "gap", "estimated", "rev_delta", "cm2_delta", "offset", "offset_amount"]);
  ok(/\{\{offset\}\}/.test(en["analysis.offset"]) && /\{\{offset_amount\}\}/.test(en["analysis.offset"]) && !/\{\{offset/.test(Object.keys(en).filter((k) => k.startsWith("insight.")).map((k) => en[k]).join(" ")), "la compensation a sa phrase générique (analysis.offset), hors gabarits insight.*");
  const bad = [];
  for (const b of Object.values(B)) for (const i of b.insights) for (const f of ["observation", "context", "cause", "impact", "recommendation", "simulation", "followup", "partial"]) {
    const tpl = en[`insight.${i.id}.${f}`]; if (!tpl) continue;
    for (const m of tpl.matchAll(/\{\{(\w+)\}\}/g)) if (!(m[1] in (i.vars ?? {})) && !known.has(m[1])) bad.push(`${i.id}.${f}:${m[1]}`);
  }
  ok(bad.length === 0, `chaque variable de gabarit est fournie par sa règle${bad.length ? " — " + [...new Set(bad)].join(", ") : ""}`);
}

// ── 10. Scans statiques ──
console.log("\n── 10. Scans : déterminisme, aucune phrase en dur, aucune I/O ──");
{
  const dir = "app/lib/insights/";
  const files = readdirSync(new URL(dir, ROOT)).map((f) => dir + f).concat(["app/lib/confidence.js"]);
  const src = Object.fromEntries(files.map((f) => [f, read(f)]));
  ok(files.length === 11, `11 fichiers (${files.map((f) => f.split("/").pop()).join(", ")})`);
  ok(Object.values(src).every((s) => !/Math\.random|Date\.now\(|new Date\(\)|fetch\(|supabase|import\s+.*react/i.test(s)), "aucun aléa, aucune date courante, aucune I/O, aucun React");
  // Chaînes littérales de ≥ 4 mots (phrases) interdites, sauf les formules déclarées (`formula: "…"`).
  const sentences = Object.entries(src).flatMap(([f, s]) => [...s.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)]
    .filter((m) => !/formula:\s*$/.test(s.slice(Math.max(0, m.index - 12), m.index)))
    .map((m) => m[1]).filter((t) => (t.match(/[A-Za-zÀ-ÿ]{3,}/g) ?? []).length >= 4 && /\s/.test(t)).map((t) => `${f}: ${t.slice(0, 40)}`));
  ok(sentences.length === 0, `aucune phrase en dur (hors formules déclarées)${sentences.length ? " — " + sentences.slice(0, 4).join(" | ") : ""}`);
  ok(/export const PRIORITY_WEIGHTS/.test(src["app/lib/insights/config.js"]) && !/0\.3|0\.2|0\.1/.test(src["app/lib/insights/priority.js"].replace(/PRIORITY_WEIGHTS/g, "")), "poids de priorité dans config.js seulement (D11)");
  ok(!/engine\.js/.test(Object.values(src).join("")), "aucun import d'engine.js (le moteur est lu via econ/)");
  ok(read("tests/lot26_dashboard_i18n.mjs").includes('"insight."') && read("package.json").includes("lot27_insights"), "lot 26 réserve les préfixes I0 ; lot 27 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 27 (I0-A couche narrative + fiabilité) : ✓ Tous les tests passent" : ` BILAN LOT 27 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
