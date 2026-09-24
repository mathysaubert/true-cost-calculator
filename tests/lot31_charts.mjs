// ════════════════════════════════════════════════════════════════════════════════
//  LOT 31 — Graphiques F4-B (B0/B1) : module pur app/lib/charts/ (échelles, graduations, tracés
//  avec trous, cascade), séries de la courbe de contribution (buildChartSeries, règle V8), jetons
//  couleur = valeurs validées par le validateur du guide dataviz, scans statiques.
//  Pour lancer : node tests/lot31_charts.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { niceStep, niceDomain, linearScale, indexScale, labelIndices, seriesExtent, linePath, seriesCounts, buildLineChart, waterfallGeometry, WATERFALL_SPEC, CHART_COLORS, CHART_W, CHART_H } from "../app/lib/charts/index.js";
import { buildChartSeries } from "../app/lib/overview.js";
import { makeShop, WINDOWS } from "./fixtures/i0_shops.mjs";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 1e-6) => a != null && b != null && Math.abs(a - b) <= eps;
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

console.log("\n── 1. Échelles et graduations ──");
{
  ok(niceStep(0.3) === 0.5 && niceStep(3) === 5 && niceStep(12) === 20 && niceStep(700) === 1000 && niceStep(1000) === 1000 && niceStep(0) === 1, "pas joli : 1 / 2 / 5 × 10^k");
  const d = niceDomain(120, 870, 5);
  ok(d.min === 0 && d.max === 1000 && d.step === 500 && d.ticks.join(",") === "0,500,1000", `domaine joli 120..870 (5 graduations visées) → ${d.min}..${d.max} pas ${d.step}`);
  const d6 = niceDomain(120, 870, 6);
  ok(d6.step === 200 && d6.ticks.join(",") === "0,200,400,600,800,1000", "6 graduations visées → pas 200 (0 inclus)");
  const neg = niceDomain(-350, 900, 5);
  ok(neg.min <= -350 && neg.max >= 900 && neg.ticks.includes(0), "domaine négatif : 0 toujours présent dans les graduations");
  ok(niceDomain(50, 50).max > 50 && niceDomain(null, null).ticks.length >= 2, "domaine plat ou vide → étendu, au moins deux graduations");
  const y = linearScale({ domain: [0, 100], range: [200, 0] });
  ok(y(0) === 200 && y(100) === 0 && y(50) === 100 && close(y.invert(100), 50) && y(null) === null, "échelle linéaire inversée (y vers le haut) et inversion");
  const x = indexScale(31, [4, 596]);
  ok(x(0) === 4 && x(30) === 596 && close(x(15), 300) && x.nearest(300) === 15 && x.nearest(-50) === 0 && x.nearest(9999) === 30 && indexScale(1, [0, 100])(0) === 50, "échelle d'index : bornes, milieu, plus proche borné");
  ok(labelIndices(5).join(",") === "0,1,2,3,4" && labelIndices(30, 6)[0] === 0 && labelIndices(30, 6).at(-1) === 29 && labelIndices(30, 6).length <= 7 && labelIndices(0).length === 0, "étiquettes de l'axe des jours : premier, dernier, au plus 6 intermédiaires");
}

console.log("\n── 2. Tracés avec trous, cascade ──");
{
  const pts = [{ day: "d1", value: 10 }, { day: "d2", value: null }, { day: "d3", value: 30 }, { day: "d4", value: 0 }];
  const x = indexScale(4, [0, 300]), y = linearScale({ domain: [0, 40], range: [200, 0] });
  const p = linePath(pts, x, y, 200);
  ok((p.line.match(/M/g) ?? []).length === 2 && (p.area.match(/Z/g) ?? []).length === 2 && p.points[1].y === null && p.points[3].y === 200, "un trou coupe le trait et l'aire (2 segments) ; un vrai zéro touche la base");
  ok(seriesExtent([pts, [{ value: -5 }]]).min === -5 && seriesExtent([pts]).max === 30 && seriesExtent([[{ value: null }]]).empty === true, "étendue commune : min négatif, max, vide");
  ok(seriesCounts(pts).defined === 3 && seriesCounts(pts).nonZero === 2, "compte : 3 définis, 2 non nuls");
  const m = buildLineChart({ series: [{ id: "a", points: pts }, { id: "a_prev", points: [{ value: 5 }, { value: 6 }, { value: 7 }, { value: 8 }], ghost: true }] });
  ok(m.n === 4 && m.width === CHART_W && m.height === CHART_H && m.series.length === 2 && m.series[1].area === "" && m.series[0].area.length > 0 && m.series[0].last.value === 0 && m.yTicks.some((t) => t.value === 0) && close(m.xPct(3), 100) && m.nearest(50) === 2, "modèle : 2 séries, fantôme sans aire, dernier point, graduation 0, positions en %");
  ok(buildLineChart({ series: [{ id: "a", points: [{ value: null }, { value: null }] }] }).empty === true, "séries sans valeur → modèle vide");
  const w = waterfallGeometry([{ id: "ca_ht", op: "", value: 1000 }, { id: "cogs", op: "−", value: 400 }, { id: "shipping_cost", op: "−", value: null }, { id: "cm2", op: "=", value: 600 }, { id: "ad_spend", op: "−", value: 700 }, { id: "cm3", op: "=", value: -100 }]);
  const by = Object.fromEntries(w.bars.map((b) => [b.id, b]));
  ok(by.ca_ht.kind === "start" && by.cogs.from === 600 && by.cogs.to === 1000 && by.cogs.value === -400 && by.shipping_cost.missing && by.cm2.kind === "total" && by.cm2.value === 600 && by.cm3.value === -100 && by.cm3.negative === true, "cascade : départ, coût flottant, coût manquant, totaux ancrés, total négatif marqué");
  ok(w.lo === -100 && w.hi === 1000 && close(w.zeroPct, (100 / 1100) * 100) && by.ca_ht.widthPct > by.cogs.widthPct && close(by.cm2.leftPct, w.zeroPct), "cascade : bornes, zéro en %, largeurs proportionnelles");
  ok(WATERFALL_SPEC.length === 12 && WATERFALL_SPEC.filter(([op]) => op === "=").map(([, id]) => id).join(",") === "cm2,cm3,net_result" && WATERFALL_SPEC[0][1] === "ca_ht" && WATERFALL_SPEC.filter(([op]) => op === "−").length === 8, "spécification : 12 lignes, départ CA HT, 8 coûts, totaux CM2 / CM3 / résultat (B2)");
  const healthy0 = makeShop("healthy"), lv = healthy0.current.agg.shop.leaves, nd = healthy0.current.agg.shop.nodes;
  const real = waterfallGeometry(WATERFALL_SPEC.map(([op, id]) => ({ id, op, value: id in nd ? nd[id] : lv[id] })));
  const cm2Bar = real.bars.find((b) => b.id === "cm2"), costs = real.bars.filter((b) => b.kind === "cost" && !b.missing);
  ok(close(cm2Bar.value, nd.cm2, 1e-6) && close(real.bars[0].value - costs.slice(0, 5).reduce((s, b) => s + Math.abs(b.value), 0), nd.cm2, 0.02), "boutique saine : CA HT − 5 coûts = CM2 du moteur au centime ; totaux = nœuds");
}

console.log("\n── 3. Séries de la courbe de contribution (V2, V8) ──");
{
  const healthy = makeShop("healthy");
  const cs = buildChartSeries({ current: healthy.current.agg, previous: healthy.previous[0].agg, window: WINDOWS[0], previousWindow: WINDOWS[1] });
  ok(cs.enough === true && cs.days.length === 30 && cs.series.ca_ht.current.length === 30 && cs.series.ca_ht.previous.length === 30 && cs.series.cm2.current.length === 30, "saine : 30 jours, séries courante et précédente alignées pour CA HT et CM2");
  ok(cs.series.ca_ht.current.every((p) => p.day && (p.value == null || typeof p.value === "number")) && cs.previousDays.length === 30, "points { day, value } ; jours précédents exposés");
  const total = cs.series.ca_ht.current.reduce((s, p) => s + (p.value ?? 0), 0);
  ok(close(total, healthy.current.agg.shop.nodes.ca_ht, 0.05), `Σ CA HT par jour = CA HT de la période (${total.toFixed(2)})`);
  const cm2Days = cs.series.cm2.current.filter((p) => p.value != null).length;
  ok(cm2Days >= 2 && cs.partialCm2 === false, "CM2 défini sur les jours à coût connu ; boutique saine : aucune ligne à coût inconnu");
  const missing = makeShop("missing");
  const cm = buildChartSeries({ current: missing.current.agg, previous: missing.previous[0].agg, window: WINDOWS[0], previousWindow: WINDOWS[1] });
  ok(cm.partialCm2 === true, "boutique manquante : CM2 marquée partielle (lignes à coût inconnu)");
  const empty = buildChartSeries({ current: { byDay: {}, shop: { leaves: {}, nodes: {} } }, previous: null, window: WINDOWS[0], previousWindow: WINDOWS[1] });
  ok(empty.enough === false && empty.series.ca_ht.previous.length === 0, "aucune commande → pas assez de jours, aucune série précédente");
  const one = buildChartSeries({ current: { byDay: { [WINDOWS[0].start]: { nodes: { ca_ht: 100, cm2: 40 } } }, shop: { leaves: {}, nodes: {} } }, previous: null, window: WINDOWS[0], previousWindow: WINDOWS[1] });
  ok(one.enough === false, "un seul jour avec valeur → pas assez (V8 : 2 jours définis et 2 valeurs non nulles)");
}

console.log("\n── 4. Couleurs validées, scans ──");
{
  const css = read("app/styles/overview.css");
  const light = css.slice(0, css.indexOf('[data-theme="dark"]'));
  const dark = css.slice(css.indexOf('[data-theme="dark"]'));
  ok(new RegExp(`--tcc-chart-revenue:\\s*${CHART_COLORS.light.revenue}`).test(light) && new RegExp(`--tcc-chart-cm2:\\s*${CHART_COLORS.light.cm2}`).test(light) && new RegExp(`--tcc-chart-previous:\\s*${CHART_COLORS.light.previous}`).test(light), "jetons clairs = couleurs validées (revenus, CM2, précédent)");
  ok((dark.match(new RegExp(`--tcc-chart-cm2:\\s*${CHART_COLORS.dark.cm2}`, "g")) ?? []).length === 2 && (dark.match(new RegExp(`--tcc-chart-revenue:\\s*${CHART_COLORS.dark.revenue}`, "g")) ?? []).length === 2, "jetons sombres = couleurs validées, déclarés sous les deux portées sombres");
  ok(CHART_COLORS.light.cm2 !== "#6a56d9" && CHART_COLORS.dark.cm2 !== "#9085e9", "CM2 ne réutilise pas le violet des marges (paire bleu/violet refusée par le validateur : ΔE 9,9 / 9,8)");
  const pure = ["scale", "line", "waterfall", "index"].map((f) => read(`app/lib/charts/${f}.js`)).join("\n");
  ok(!/import\s+.*react|supabase|fetch\(|Date\.now\(|new Date\(|Math\.random|document\.|window\./i.test(pure), "module pur : aucune dépendance, aucun React, aucune I/O, aucun DOM");
  const ui = read("app/components/charts/ContributionChart.jsx");
  ok(/preserveAspectRatio="none"/.test(ui) && /vectorEffect="non-scaling-stroke"/.test(ui) && !/<text/.test(ui) && /<input type="range" className="tcc-chart__reader"/.test(ui) && /aria-valuetext=/.test(ui) && !/onKeyDown|tabIndex/.test(ui) && /role="status"/.test(ui), "composant : SVG étiré sans texte interne (axes en HTML), traits non déformés, clavier par curseur natif (flèches, Home / End, valeur annoncée), infobulle annoncée");
  ok(!/style=\{\{(?!\s*"--)/.test(ui) && !/#[0-9a-fA-F]{6}\b/.test(ui) && /data-x=/.test(ui) && /data-pct=/.test(ui), "aucune couleur ni propriété CSS inline : seules des variables de géométrie (--x, --y, --pct) lues par la feuille");
  const wf = read("app/components/charts/WaterfallChart.jsx");
  ok(!/style=\{\{(?!\s*"--)/.test(wf) && !/#[0-9a-fA-F]{6}\b/.test(wf) && /role="img"/.test(wf) && /<WaterfallTable [^>]*bare/.test(wf) && /waterfallGeometry\(/.test(wf) && !/<svg/.test(wf), "cascade : HTML + variables de géométrie, image nommée, tableau accessible sous dépliage, aucune couleur inline");
  const sp = read("app/components/overview/Sparkline.jsx");
  ok(/tcc-spark__ghost/.test(sp) && /tcc-spark__dot/.test(sp) && /strokeWidth="8"/.test(sp) && /vectorEffect="non-scaling-stroke"/.test(sp), "mini-courbe : fantôme pointillé et point final de 8 px non déformé (B3)");
  ok(/tcc-chart\b[^{]*\{[^}]*block-size:\s*16rem/.test(css) && /tcc-chart--empty[^{]*\{[^}]*min-block-size:\s*16rem|\.tcc-chart--empty[^{]*\{[^}]*block-size:\s*16rem/.test(css), "hauteur réservée 16 rem partagée entre la courbe et la carte vide (CLS)");
  ok(read("package.json").includes("lot31_charts"), "lot 31 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 31 (graphiques F4-B) : ✓ Tous les tests passent" : ` BILAN LOT 31 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
