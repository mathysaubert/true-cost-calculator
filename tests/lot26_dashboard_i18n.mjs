// ════════════════════════════════════════════════════════════════════════════════
//  LOT 26 — F4-A : i18n (locale, t, catalogues, lint « aucune chaîne en dur »), adaptateur
//  faits → moteur (C7), remappage boutique de dev (C6), fenêtres, statuts KPI, formatage.
//  Pur : aucune I/O réseau, aucune base. Pour lancer : node tests/lot26_dashboard_i18n.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveLocale, normalizeLocale, parseAcceptLanguage, readCookie, localeCookieHeader, localeDir, SUPPORTED_LOCALES } from "../app/lib/i18n/resolveLocale.js";
import { createTranslator, baseKeys, interpolate } from "../app/lib/i18n/t.js";
import { formatMoney, formatPct, formatDelta, formatDay, formatRatio } from "../app/lib/i18n/format.js";
import { CATALOGS } from "../app/locales/index.js";
import { lineFromOrderMarginsRow, linesFromOrderMarginsRows, ordersForEngine, applyOrderDiscounts, DEV_INCLUDABLE_REASONS } from "../app/lib/econ/adapters.js";
import { aggregate } from "../app/lib/econ/aggregate.js";
import { dashboardWindows, parsePeriodDays, buildKpis, buildNotes, buildGaps, kpiDelta, KPI_DEFS, DASHBOARD_LINES_CAP } from "../app/lib/dashboard.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 0.01) => a != null && b != null && Math.abs(a - b) < eps;
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

// ── 1. Résolution de la locale (C3) ──
console.log("\n── 1. resolveLocale ──");
{
  ok(normalizeLocale("fr-CA") === "fr", "fr-CA → fr");
  ok(normalizeLocale("pt-BR") === "pt-BR" && normalizeLocale("pt") === "pt-BR" && normalizeLocale("pt-PT") === "pt-PT", "pt-BR / pt / pt-PT distincts");
  ok(normalizeLocale("zh-TW") === "zh-TW" && normalizeLocale("zh-Hant-TW") === "zh-TW" && normalizeLocale("zh") === "zh-CN", "zh-TW ≠ zh-CN ; zh-Hant → zh-TW ; zh → zh-CN");
  ok(normalizeLocale("xx") === null && normalizeLocale("") === null && normalizeLocale(null) === null && normalizeLocale("<script>") === null, "inconnu / vide / injection → null");
  ok(resolveLocale({ override: "de", param: "fr", cookie: "es", acceptLanguage: "it" }).locale === "de", "surcharge > paramètre");
  ok(resolveLocale({ param: "fr", cookie: "es", acceptLanguage: "it" }).locale === "fr", "paramètre > cookie");
  ok(resolveLocale({ cookie: "es", acceptLanguage: "it" }).locale === "es", "cookie > Accept-Language");
  const al = resolveLocale({ acceptLanguage: "xx,fr-CA;q=0.8,en;q=0.9" });
  ok(al.locale === "en" && al.source === "accept_language", "Accept-Language : poids q respectés (en 0.9 > fr 0.8), inconnu ignoré");
  ok(resolveLocale({}).locale === "en" && resolveLocale({}).source === "default", "rien → en (default)");
  ok(parseAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8").join(",") === "fr-CA,fr,en", "parseAcceptLanguage ordonné");
  ok(readCookie("a=1; tcc_locale=fr; b=2", "tcc_locale") === "fr" && readCookie("", "tcc_locale") === null, "readCookie");
  const h = localeCookieHeader("fr");
  ok(/^tcc_locale=fr; Path=\/; Max-Age=\d+; SameSite=None; Secure; HttpOnly$/.test(h), "cookie SameSite=None; Secure; HttpOnly (iframe admin)");
  ok(localeDir("ar") === "rtl" && localeDir("he") === "rtl" && localeDir("ur") === "rtl" && localeDir("fr") === "ltr", "dir : ar/he/ur = rtl");
  ok(SUPPORTED_LOCALES.length === 36 && new Set(SUPPORTED_LOCALES).size === 36, `36 codes de l'admin déclarés (${SUPPORTED_LOCALES.length})`);
}

// ── 2. t() ──
console.log("\n── 2. createTranslator ──");
{
  const missing = [];
  const t = createTranslator({ catalogs: { en: { "a.b": "Hello {{name}}", "n.items_one": "{{count}} item", "n.items_other": "{{count}} items", "only.en": "EN" }, fr: { "a.b": "Bonjour {{name}}", "n.items_one": "{{count}} élément", "n.items_other": "{{count}} éléments" } }, locale: "fr", onMissing: (k, l, why) => missing.push(`${k}:${why}`) });
  ok(t("a.b", { name: "Mathys" }) === "Bonjour Mathys", "clé présente + interpolation");
  ok(t("n.items", { count: 1 }) === "1 élément" && t("n.items", { count: 3 }) === "3 éléments" && t("n.items", { count: 0 }) === "0 élément", "pluriel fr : 0 et 1 singulier, 3 pluriel (Intl.PluralRules)");
  const en = createTranslator({ catalogs: { en: { "n.items_one": "{{count}} item", "n.items_other": "{{count}} items" } }, locale: "en" });
  ok(en("n.items", { count: 0 }) === "0 items" && en("n.items", { count: 1 }) === "1 item", "pluriel en : 0 pluriel, 1 singulier");
  ok(t("only.en") === "EN" && missing.includes("only.en:fallback"), "clé absente en fr → repli en, signalé");
  ok(t("nope.key") === "nope.key" && missing.includes("nope.key:missing"), "clé absente partout → la clé (jamais vide), signalé");
  ok(interpolate("{{a}}-{{b}}", { a: 1 }) === "1-", "variable absente → vide, pas « undefined »");
  ok(t.has("a.b") && !t.has("zzz"), "t.has");
}

// ── 3. Catalogues en / fr ──
console.log("\n── 3. Catalogues : fr = en, aucune clé orpheline, aucune clé absente ──");
const F4_FILES = [
  "app/routes/app.jsx", "app/routes/app.dashboard.jsx", "app/root.jsx", "app/lib/i18n/context.jsx",
  ...readdirSync(new URL("app/components/dashboard/", ROOT)).map((f) => `app/components/dashboard/${f}`),
];
{
  const enKeys = baseKeys(CATALOGS.en), frKeys = baseKeys(CATALOGS.fr);
  const onlyEn = [...enKeys].filter((k) => !frKeys.has(k)), onlyFr = [...frKeys].filter((k) => !enKeys.has(k));
  ok(onlyEn.length === 0, `fr.js porte toutes les clés de en.js${onlyEn.length ? " — manquantes : " + onlyEn.join(", ") : ""}`);
  ok(onlyFr.length === 0, `fr.js n'a aucune clé hors en.js${onlyFr.length ? " — en trop : " + onlyFr.join(", ") : ""}`);
  ok(Object.values(CATALOGS.en).every((v) => typeof v === "string" && v.trim()) && Object.values(CATALOGS.fr).every((v) => typeof v === "string" && v.trim()), "aucune valeur vide");
  // Clés utilisées dans les fichiers F4 : t("literal"), t(`prefix.${x}`) → préfixe vérifié par famille.
  const src = F4_FILES.map((f) => read(f)).join("\n");
  const literal = [...src.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const dyn = [...src.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)].map((m) => m[1]);
  const navLabels = [...src.matchAll(/label\("([^"]+)"\)/g)].map((m) => m[1]);
  const missingLit = [...new Set([...literal, ...navLabels])].filter((k) => !enKeys.has(k));
  ok(missingLit.length === 0, `toute clé littérale utilisée existe dans en.js${missingLit.length ? " — absentes : " + missingLit.join(", ") : ""}`);
  const families = [...new Set(dyn)];
  ok(families.every((p) => [...enKeys].some((k) => k.startsWith(p))), `chaque famille dynamique (${families.join(" | ")}) a des clés dans en.js`);
  // Familles dynamiques : leurs membres attendus existent.
  const need = [
    ...KPI_DEFS.flatMap((d) => [`dashboard.kpi.${d.id}.label`, `dashboard.kpi.${d.id}.help`]),
    ...KPI_DEFS.flatMap((d) => d.inputs.map((i) => `dashboard.calc.input.${i}`)),
    ...["revenue", "margins", "acquisition"].map((g) => `dashboard.section.${g}`),
    ...["test", "draft", "cancelled", "gift_card_only", "b2b"].map((r) => `dashboard.excluded.${r}`),
    ...["ads", "sessions", "customers"].map((s) => `dashboard.status.unavailable.${s}`),
    ...["orders", "known_orders", "sessions", "checkout_sessions", "first_orders", "attributed_orders", "customers", "months", "orders_out_of_window", "delivered", "shipped", "sales_days", "days"].map((m) => `dashboard.missing.${m}`),
    ...["no_ad_source", "no_fixed_costs", "provisional", "known_share"].map((n) => `dashboard.note.${n}`),
    ...["unknown_cost_lines", "unconfirmed_fees", "unconfirmed_shipping", "no_packaging_cost", "legacy_lines", "capped", "excluded"].map((g) => `dashboard.gaps.${g}`),
  ];
  const missingDyn = need.filter((k) => !enKeys.has(k));
  ok(missingDyn.length === 0, `membres des familles dynamiques présents (${need.length})${missingDyn.length ? " — absents : " + missingDyn.join(", ") : ""}`);
  const used = new Set([...literal, ...navLabels, ...need]);
  const orphan = [...enKeys].filter((k) => !used.has(k) && !families.some((p) => k.startsWith(p)));
  ok(orphan.length === 0, `aucune clé orpheline dans en.js${orphan.length ? " — " + orphan.join(", ") : ""}`);
}

// ── 4. Lint : aucune chaîne en dur dans app/ hors liste d'exclusion (C9b) ──
console.log("\n── 4. Lint i18n : aucune chaîne en dur (JSX) hors exclusions ──");
{
  // Exclusion = ancien code (retiré en F4-D) + serveur sans UI. La liste se VIDE au fil de F4.
  const EXCLUDE = new Set([
    "app/routes/app._index.jsx", "app/components/costsUi.jsx", "app/components/customsUi.jsx",
    "app/routes/auth.login/route.jsx", "app/routes/_index/route.jsx", "app/routes/debug.jsx", "app/routes/privacy.jsx",
    "app/routes/auth.session-token.jsx", "app/routes/auth.$.jsx", "app/root.jsx", // root : ErrorBoundary sans locale (hors coquille)
  ]);
  const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(jsx|js)$/.test(f)) out.push(p); } return out; };
  const appDir = new URL("app/", ROOT).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const files = walk(appDir).map((p) => relative(appDir.replace(/\/$/, ""), p).replace(/\\/g, "/")).map((p) => `app/${p}`).filter((p) => !EXCLUDE.has(p) && !p.startsWith("app/locales/"));
  const offenders = [];
  for (const f of files) {
    const s = read(f);
    if (!/<[a-z]|<[A-Z]\w*/.test(s) || !/from "react/.test(s) && !/jsx/.test(f)) continue; // pas de JSX
    const lines = s.split("\n");
    lines.forEach((line, i) => {
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;
      // Texte JSX littéral juste après une balise ouvrante ou fermante : <tag …>Mot< (≥ 2 lettres, hors {expr})
      for (const m of line.matchAll(/(?:<[A-Za-z][\w.-]*(?:\s[^<>]*)?|<\/[\w.-]+)>([^<>{}]*[A-Za-zÀ-ÿ]{2,}[^<>{}]*)</g)) offenders.push(`${f}:${i + 1} texte « ${m[1].trim().slice(0, 40)} »`);
      // Attributs textuels en dur.
      for (const m of line.matchAll(/\b(heading|label|placeholder|accessibilityLabel|title|alt)="([^"]*[A-Za-zÀ-ÿ]{2,}[^"]*)"/g)) offenders.push(`${f}:${i + 1} ${m[1]}=« ${m[2].slice(0, 40)} »`);
    });
  }
  ok(files.some((f) => f === "app/routes/app.dashboard.jsx") && files.some((f) => f === "app/routes/app.jsx"), `fichiers F4 scannés (${files.length} fichiers app/ hors exclusions)`);
  ok(offenders.length === 0, `aucune chaîne en dur${offenders.length ? "\n      " + offenders.slice(0, 12).join("\n      ") : ""}`);
  // Aucune couleur ni style inline dans les composants du Tableau de bord ; aucun import des anciens formateurs.
  const dash = F4_FILES.filter((f) => f.startsWith("app/components/dashboard/") || f === "app/routes/app.dashboard.jsx");
  const bad = dash.filter((f) => /style=\{\{|#[0-9a-fA-F]{6}\b/.test(read(f)));
  ok(bad.length === 0, `aucun style inline ni couleur hexadécimale dans le Tableau de bord${bad.length ? " — " + bad.join(", ") : ""}`);
  const badImp = [...dash, "app/routes/app.jsx", "app/lib/dashboard.js", "app/lib/dashboard.server.js", "app/lib/econ/adapters.js"].filter((f) => /engine\.js|orderHistory\.js|toLocaleDateString|"fr-FR"/.test(read(f)));
  ok(badImp.length === 0, `aucun import d'engine.js / orderHistory.js ni fr-FR en dur dans les fichiers F4${badImp.length ? " — " + badImp.join(", ") : ""}`);
  ok(!/shopify\.config\.locale/.test(F4_FILES.map(read).join("")), "la locale rendue ne vient jamais de shopify.config.locale (pas de mismatch d'hydratation)");
}

// ── 5. Adaptateur ligne stockée → ligne moteur (C7) ──
console.log("\n── 5. lineFromOrderMarginsRow ──");
const row1022 = { order_id: "gid://shopify/Order/1022", line_item_id: "L1", product_id: "P1", variant_id: "V1", quantity: 1, refunded_qty: 1, effective_qty: 0, unit_price_ht: 600, tax_lines: [], is_gift_card: false, cm1_components: null, cm1_unit: null, cm2_alloc: { emballage: 0, paiement: 0, port_marchand: 0 }, breakdown_version: 2, cost_source: "missing", currency_code: "USD", day_local: "2026-09-23" };
{
  const l = lineFromOrderMarginsRow(row1022);
  ok(l && l.revenue_units === 0 && l.cogs_units === 0 && l.cost_source === "missing" && l.cm1_unit === null && l.cout_rendu_unit === null, "#1022 remboursée, coût manquant : 0 unité comptée, CM1 null (jamais 0)");
  ok(l.unit_price_ttc === 600 && l.tax_per_unit === 0, "sans ligne de taxe : TTC = HT");
  const legacy = lineFromOrderMarginsRow({ ...row1022, breakdown_version: null, unit_price_ht: null });
  ok(legacy === null, "ligne legacy (sans breakdown_version) → null");
  const { lines, legacy: n } = linesFromOrderMarginsRows([row1022, { ...row1022, line_item_id: "L2", breakdown_version: null }]);
  ok(lines.length === 1 && n === 1, "lot : 1 convertie, 1 legacy comptée");
  const taxed = lineFromOrderMarginsRow({ ...row1022, quantity: 2, refunded_qty: 0, effective_qty: 2, unit_price_ht: 100, tax_lines: [{ amount: 40 }], cm1_unit: 83.2, cost_source: "confirmed" });
  ok(close(taxed.tax_per_unit, 20) && close(taxed.unit_price_ttc, 120) && close(taxed.cout_rendu_unit, 16.8) && taxed.revenue_units === 2 && taxed.cogs_units === 2, "avec taxes : tax/unité 20, TTC 120, coût rendu = HT − CM1 = 16,80");
  const gift = lineFromOrderMarginsRow({ ...row1022, is_gift_card: true, cm1_unit: 5 });
  ok(gift.cost_source === "excluded" && gift.cm1_unit === null, "carte cadeau → exclue");
}

// ── 6. Remappage boutique de dev (C6) ──
console.log("\n── 6. ordersForEngine : brouillons/tests inclus SEULEMENT sur demande ──");
const orderRows = [
  { order_id: "o1", day_local: "2026-09-10", created_at: "2026-09-10T10:00:00Z", excluded_reason: "draft", currency_code: "USD", discounts_amount: 10, shipping_charged: 0 },
  { order_id: "o2", day_local: "2026-09-11", created_at: "2026-09-11T10:00:00Z", excluded_reason: "test", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 },
  { order_id: "o3", day_local: "2026-09-12", created_at: "2026-09-12T10:00:00Z", excluded_reason: "cancelled", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 },
  { order_id: "o4", day_local: "2026-09-12", created_at: "2026-09-12T10:00:00Z", excluded_reason: "b2b", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 },
  { order_id: "o5", day_local: "2026-09-13", created_at: "2026-09-13T10:00:00Z", excluded_reason: null, currency_code: "USD", discounts_amount: 5, shipping_charged: 4 },
];
{
  const off = ordersForEngine(orderRows, { includeTestOrders: false, refunds: [{ order_id: "o5", shipping_refunded: 4, settled: true }] });
  ok(off.orders.filter((o) => !o.excluded_reason).length === 1 && off.reincluded === 0 && off.excluded.draft === 1 && off.excluded.test === 1, "désactivé : seule o5 incluse, compteurs draft/test à 1");
  ok(off.orders.find((o) => o.order_id === "o5").shipping_refunded === 4, "port remboursé rattaché depuis refunds");
  const on = ordersForEngine(orderRows, { includeTestOrders: true });
  ok(on.orders.filter((o) => !o.excluded_reason).length === 3 && on.reincluded === 2, "activé : o1 (draft) et o2 (test) réintégrées");
  ok(on.excluded.cancelled === 1 && on.excluded.b2b === 1 && on.orders.find((o) => o.order_id === "o3").excluded_reason === "cancelled", "cancelled et b2b restent exclues quoi qu'il arrive");
  ok(DEV_INCLUDABLE_REASONS.join(",") === "draft,test", "liste C6 = draft, test");
}

// ── 7. applyOrderDiscounts (C7b) : remise de commande → ca_brut/remises boutique et jour ──
console.log("\n── 7. applyOrderDiscounts ──");
const settings = { shop_country_code: "US", shop_timezone: "UTC", return_window_days: 30, packaging_cost_per_order: 0, shipping_cost_rules: { default: 0, confirmed: true }, gateway_fee_rules: [{ gateway: "*", pct: 0, fixed: 0, confirmed: true }] };
const win = { start: "2026-09-01", end: "2026-09-30" };
{
  const lines = [{ ...lineFromOrderMarginsRow({ ...row1022, order_id: "o5", quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: 100, cm1_unit: 60, cost_source: "confirmed", day_local: "2026-09-13" }) }];
  const { orders } = ordersForEngine(orderRows, { includeTestOrders: false });
  const base = aggregate({ orders, lines, settings, window: win, now: new Date("2026-10-20T00:00:00Z") });
  ok(close(base.shop.nodes.ca_ht, 104) && close(base.shop.leaves.remises, 0), "sans injection : CA HT 104 (100 produit + 4 port client, décision 1), remises 0 (ligne sans prix d'origine)");
  const withD = applyOrderDiscounts(base, orders, win);
  ok(close(withD.shop.leaves.remises, 5) && close(withD.shop.leaves.ca_brut, base.shop.leaves.ca_brut + 5) && close(withD.shop.nodes.ca_ht, 104), "remise de commande injectée : remises 5, CA brut +5, CA HT inchangé (104)");
  ok(close(withD.byDay["2026-09-13"].leaves.remises, 5), "jour de la commande mis à jour");
  ok(base.shop.leaves.remises === 0, "non mutant : le résultat d'origine est intact");
  ok(applyOrderDiscounts(base, orders, { start: "2026-08-01", end: "2026-08-31" }) === base, "aucune remise dans la fenêtre → même objet");
}

// ── 8. Fenêtres et période ──
console.log("\n── 8. dashboardWindows ──");
{
  const w = dashboardWindows({ now: new Date("2026-09-23T03:00:00Z"), timeZone: "America/New_York", days: 30 });
  ok(w.current.end === "2026-09-21" && w.current.start === "2026-08-23", `fenêtre 30 j finissant hier (jour boutique New York : 22 → hier 21) : ${w.current.start} → ${w.current.end}`);
  ok(w.previous.end === "2026-08-22" && w.previous.start === "2026-07-24", `précédente contiguë de 30 j : ${w.previous.start} → ${w.previous.end}`);
  const w7 = dashboardWindows({ now: new Date("2026-09-23T12:00:00Z"), timeZone: "UTC", days: 7 });
  ok(w7.current.start === "2026-09-16" && w7.current.end === "2026-09-22" && w7.previous.start === "2026-09-09", "7 jours UTC");
  ok(parsePeriodDays("90") === 90 && parsePeriodDays("12") === 30 && parsePeriodDays(null) === 30, "parsePeriodDays : 7/30/90 seulement, sinon 30");
}

// ── 9. Statuts KPI (buildKpis) sur les trois états de la boutique de dev ──
console.log("\n── 9. buildKpis : vide / coûts manquants / coûts saisis ──");
{
  const now = new Date("2026-10-20T00:00:00Z");
  const prevWin = { start: "2026-08-02", end: "2026-08-31" };
  // État 1 : tout exclu → vide.
  const off = ordersForEngine(orderRows, { includeTestOrders: false });
  const e1 = aggregate({ orders: off.orders.filter((o) => o.order_id !== "o5"), lines: [], settings, window: win, now });
  const k1 = buildKpis({ current: e1, previous: aggregate({ orders: [], lines: [], settings, window: prevWin, now }) });
  ok(k1.length === 12 && k1.filter((k) => k.primary).length === 8, "12 KPI dont 8 primaires (décision 14, C10)");
  ok(k1.every((k) => k.status === "insufficient" && k.missing?.orders === 1), "état vide : tous les KPI « insuffisant : encore 1 commande », aucun zéro « ok »");
  ok(e1.shop.leaves.orders === 0, "0 commande incluse");
  // État 2 : commande incluse, coût manquant.
  const on = ordersForEngine(orderRows, { includeTestOrders: true });
  const l2 = [lineFromOrderMarginsRow({ ...row1022, order_id: "o1", quantity: 1, refunded_qty: 0, effective_qty: 1, day_local: "2026-09-10" })];
  const e2 = aggregate({ orders: on.orders, lines: l2, settings, window: win, now });
  const k2 = Object.fromEntries(buildKpis({ current: e2, previous: e1 }).map((k) => [k.id, k]));
  ok(k2.ca_ht.status === "ok" && close(k2.ca_ht.value, 604) && k2.orders.status === "ok" && k2.orders.value === 3, "état 2 : CA HT 604 (600 + 4 de port client sur o5) et 3 commandes « ok »");
  ok(k2.aov.status === "insufficient" && k2.aov.missing.orders === 7, "panier moyen : « encore 7 commandes » (minData 10)");
  ok(k2.cm2_pct.status === "insufficient" && k2.cm2_pct.missing.known_orders === 10, "CM2 % : « encore 10 commandes à coût connu »");
  ok(k2.cm3.status === "unknown" && k2.cm3.reason === "costs" && k2.cm3.unknown_cost_lines === 1, "CM3 : inconnu, 1 ligne sans coût (jamais 0)");
  ok(k2.net_result.status === "unknown", "résultat net : inconnu");
  ok(k2.cvr.status === "unavailable" && k2.cvr.source === "sessions", "CVR : sessions non connectées");
  ok(k2.cac_global.status === "unavailable" && k2.mer.status === "unavailable" && k2.poas.status === "unavailable" && k2.ltv_cac.status === "unavailable", "CAC / MER / POAS / LTV-CAC : source pub non connectée");
  ok(k2.return_rate.status === "insufficient", "taux de retour : insuffisant (50 commandes hors délai)");
  ok(k2.ca_ht.delta === null, "aucune période précédente → pas d'écart");
  // État 3 : coûts saisis (10 commandes à coût connu) → CM2 chiffrée, écart vs période précédente.
  const many = Array.from({ length: 12 }, (_, i) => ({ order_id: `m${i}`, day_local: `2026-09-${String(10 + i).padStart(2, "0")}`, created_at: `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00Z`, excluded_reason: null, currency_code: "USD", discounts_amount: 0, shipping_charged: 0, customer_order_index: 1 }));
  const manyLines = many.map((o) => lineFromOrderMarginsRow({ ...row1022, order_id: o.order_id, line_item_id: `L${o.order_id}`, quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: 100, cm1_unit: 60, cost_source: "confirmed", day_local: o.day_local }));
  const prevMany = many.slice(0, 10).map((o) => ({ ...o, order_id: `p${o.order_id}`, day_local: o.day_local.replace("-09-", "-08-"), created_at: o.created_at.replace("-09-", "-08-") }));
  const prevLines = prevMany.map((o) => lineFromOrderMarginsRow({ ...row1022, order_id: o.order_id, line_item_id: `L${o.order_id}`, quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: 80, cm1_unit: 40, cost_source: "confirmed", day_local: o.day_local }));
  const cur3 = aggregate({ orders: [...many, ...prevMany], lines: [...manyLines, ...prevLines], settings, window: win, now });
  const prev3 = aggregate({ orders: [...many, ...prevMany], lines: [...manyLines, ...prevLines], settings, window: prevWin, now });
  const k3 = Object.fromEntries(buildKpis({ current: cur3, previous: prev3 }).map((k) => [k.id, k]));
  ok(k3.cm2_pct.status === "ok" && close(k3.cm2_pct.value, 60) && k3.cm3.status === "ok" && close(k3.cm3.value, 720), "état 3 : CM2 60 %, CM3 720 (12 × 60)");
  ok(k3.ca_ht.delta?.kind === "pct" && close(k3.ca_ht.delta.value, 50), "écart CA HT : +50 % (1 200 vs 800)");
  ok(k3.cm2_pct.delta?.kind === "points" && close(k3.cm2_pct.delta.value, 10), "écart CM2 % en points : +10 pt (60 vs 50)");
  ok(kpiDelta("money", 100, 0) === null && kpiDelta("money", null, 5) === null, "écart : base nulle ou valeur absente → null");
  const notes = buildNotes(cur3);
  ok(notes.some((n) => n.id === "no_ad_source") && notes.some((n) => n.id === "no_fixed_costs"), "notes : pub non connectée, coûts fixes absents");
  const gaps = buildGaps({ agg: e2, legacyLines: 20, capped: true, excluded: { draft: 0, cancelled: 1, b2b: 1 } });
  ok(gaps.some((g) => g.id === "unknown_cost_lines" && g.count === 1) && gaps.some((g) => g.id === "legacy_lines" && g.count === 20) && gaps.some((g) => g.id === "capped" && g.cap === DASHBOARD_LINES_CAP) && gaps.find((g) => g.id === "excluded")?.count === 2, "trous : 1 ligne sans coût, 20 legacy, plafond, 2 exclues (raisons listées)");
  ok(gaps.find((g) => g.id === "excluded").reasons.every((r) => r.count > 0), "raisons d'exclusion à compteur > 0 seulement");
}

// ── 10. Formatage ──
console.log("\n── 10. format (Intl) ──");
{
  const fr = formatMoney(1234.5, "fr", "USD"), en = formatMoney(1234.5, "en", "USD");
  ok(fr !== en && /1/.test(fr) && /234/.test(fr) && /\$|US/.test(fr) && en === "$1,234.50", `fr ≠ en pour la même valeur (${fr} / ${en})`);
  ok(formatMoney(10, "fr", "MIXED") === "10,00" && formatMoney(10, "en", null) === "10.00", "MIXED / devise absente → nombre neutre, jamais un symbole");
  ok(/XYZ$/.test(formatMoney(10, "fr", "XYZ")) && /^10/.test(formatMoney(10, "fr", "XYZ")), "devise inconnue (XYZ) → nombre + code, jamais un symbole");
  ok(formatPct(64.7, "en") === "64.7%" && /64,7/.test(formatPct(64.7, "fr")), "pourcentage par locale");
  ok(formatDelta(12.34, "en") === "+12.3%" && formatDelta(-2.5, "en", { kind: "points" }) === "-2.5 pt" && formatDelta(0, "en") === "0.0%", "écart signé (+ / − / 0 sans signe)");
  ok(formatRatio(3.571, "en") === "3.57×", "ratio ×");
  ok(formatDay("2026-09-21", "en") === "Sep 21, 2026" && /21/.test(formatDay("2026-09-21", "fr")), "jour boutique formaté sans décalage de fuseau");
  ok(formatMoney("abc", "en", "USD") === null, "valeur non numérique → null (l'écran affiche n. d.)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 26 (F4-A tableau de bord + i18n) : ✓ Tous les tests passent" : ` BILAN LOT 26 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
