// ════════════════════════════════════════════════════════════════════════════════
//  LOT 26 — F4-A : i18n (locale, t, catalogues, lint « aucune chaîne en dur »), adaptateur
//  faits → moteur (C7, retour 1 : commande sans ligne analysable exclue et comptée), remappage
//  boutique de dev (C6), fenêtres (journée en cours partielle), statuts KPI, séries, calcul,
//  jetons CSS (contrastes AA calculés, thème sombre complet, mouvement réduit, propriétés logiques).
//  Pur : aucune I/O réseau, aucune base. Pour lancer : node tests/lot26_dashboard_i18n.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveLocale, normalizeLocale, parseAcceptLanguage, readCookie, localeCookieHeader, localeDir, SUPPORTED_LOCALES } from "../app/lib/i18n/resolveLocale.js";
import { createTranslator, baseKeys, interpolate } from "../app/lib/i18n/t.js";
import { formatMoney, formatPct, formatDelta, formatDay, formatRatio, formatRelative } from "../app/lib/i18n/format.js";
import { CATALOGS } from "../app/locales/index.js";
import { lineFromOrderMarginsRow, linesFromOrderMarginsRows, ordersForEngine, applyOrderDiscounts, DEV_INCLUDABLE_REASONS, LEGACY_REASON } from "../app/lib/econ/adapters.js";
import { aggregate } from "../app/lib/econ/aggregate.js";
import { overviewWindows, parsePeriodDays, buildKpis, buildNotes, buildGaps, kpiDelta, kpiSeries, calcRows, KPI_DEFS, OVERVIEW_LINES_CAP } from "../app/lib/overview.js";
import { SECTIONS, LIVE_SECTIONS, OVERVIEW_RESERVED } from "../app/lib/sections.js";
import { sparklinePaths } from "../app/lib/sparkline.js";

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
  ok(al.locale === "en" && al.source === "accept_language", "Accept-Language : poids q respectés, inconnu ignoré");
  ok(resolveLocale({}).locale === "en" && resolveLocale({}).source === "default", "rien → en (default)");
  ok(parseAcceptLanguage("fr-CA,fr;q=0.9,en;q=0.8").join(",") === "fr-CA,fr,en", "parseAcceptLanguage ordonné");
  ok(readCookie("a=1; tcc_locale=fr; b=2", "tcc_locale") === "fr" && readCookie("", "tcc_locale") === null, "readCookie");
  ok(/^tcc_locale=fr; Path=\/; Max-Age=\d+; SameSite=None; Secure; HttpOnly$/.test(localeCookieHeader("fr")), "cookie SameSite=None; Secure; HttpOnly (iframe admin)");
  ok(localeDir("ar") === "rtl" && localeDir("he") === "rtl" && localeDir("ur") === "rtl" && localeDir("fr") === "ltr", "dir : ar/he/ur = rtl");
  ok(SUPPORTED_LOCALES.length === 36 && new Set(SUPPORTED_LOCALES).size === 36, `36 codes de l'admin déclarés (${SUPPORTED_LOCALES.length})`);
}

// ── 2. t() ──
console.log("\n── 2. createTranslator ──");
{
  const missing = [];
  const t = createTranslator({ catalogs: { en: { "a.b": "Hello {{name}}", "n.items_one": "{{count}} item", "n.items_other": "{{count}} items", "only.en": "EN" }, fr: { "a.b": "Bonjour {{name}}", "n.items_one": "{{count}} élément", "n.items_other": "{{count}} éléments" } }, locale: "fr", onMissing: (k, l, why) => missing.push(`${k}:${why}`) });
  ok(t("a.b", { name: "Mathys" }) === "Bonjour Mathys", "clé présente + interpolation");
  ok(t("n.items", { count: 1 }) === "1 élément" && t("n.items", { count: 3 }) === "3 éléments" && t("n.items", { count: 0 }) === "0 élément", "pluriel fr : 0 et 1 singulier, 3 pluriel");
  const en = createTranslator({ catalogs: { en: { "n.items_one": "{{count}} item", "n.items_other": "{{count}} items" } }, locale: "en" });
  ok(en("n.items", { count: 0 }) === "0 items" && en("n.items", { count: 1 }) === "1 item", "pluriel en : 0 pluriel, 1 singulier");
  ok(t("only.en") === "EN" && missing.includes("only.en:fallback"), "clé absente en fr → repli en, signalé");
  ok(t("nope.key") === "nope.key" && missing.includes("nope.key:missing"), "clé absente partout → la clé (jamais vide), signalé");
  ok(interpolate("{{a}}-{{b}}", { a: 1 }) === "1-", "variable absente → vide, pas « undefined »");
}

// ── 3. Catalogues en / fr ──
console.log("\n── 3. Catalogues : fr = en, aucune clé orpheline, aucune clé absente ──");
const F4_FILES = [
  "app/routes/app.jsx", "app/routes/app.overview.jsx", "app/routes/app.metrics.jsx", "app/routes/app.data-health.jsx", "app/root.jsx", "app/lib/i18n/context.jsx", "app/lib/insights/render.js",
  "app/routes/app.settings._index.jsx", "app/routes/app.settings.costs.jsx", "app/routes/app.settings.goals.jsx", "app/routes/app.settings.shop.jsx", "app/routes/app.settings.marketing.jsx", "app/routes/app.settings.connections.jsx", "app/routes/app.simulator.jsx", "app/components/simulator/Simulator.jsx",
  ...readdirSync(new URL("app/components/overview/", ROOT)).map((f) => `app/components/overview/${f}`),
  ...readdirSync(new URL("app/components/settings/", ROOT)).map((f) => `app/components/settings/${f}`),
];
{
  const enKeys = baseKeys(CATALOGS.en), frKeys = baseKeys(CATALOGS.fr);
  const onlyEn = [...enKeys].filter((k) => !frKeys.has(k)), onlyFr = [...frKeys].filter((k) => !enKeys.has(k));
  ok(onlyEn.length === 0, `fr.js porte toutes les clés de en.js${onlyEn.length ? " — manquantes : " + onlyEn.join(", ") : ""}`);
  ok(onlyFr.length === 0, `fr.js n'a aucune clé hors en.js${onlyFr.length ? " — en trop : " + onlyFr.join(", ") : ""}`);
  ok(Object.values(CATALOGS.en).every((v) => typeof v === "string" && v.trim()) && Object.values(CATALOGS.fr).every((v) => typeof v === "string" && v.trim()), "aucune valeur vide");
  ok(!/dashboard\./.test(Object.keys(CATALOGS.en).join(" ")), "renommage : plus aucune clé dashboard.* (Overview / Vue d'ensemble)");
  ok(CATALOGS.en["nav.overview"] === "Today" && CATALOGS.fr["nav.overview"] === "Aujourd'hui" && CATALOGS.fr["nav.soon"] === "Bientôt" && CATALOGS.en["nav.data_health"] === "Data health" && CATALOGS.fr["nav.data_health"] === "Fiabilité des données" && CATALOGS.fr["nav.group.steer"] === "Piloter" && CATALOGS.en["nav.group.explore"] === "Explore" && !CATALOGS.en["nav.cash"] && !CATALOGS.en["nav.experiments"], "libellés de la nav hybride imposés (en/fr), Trésorerie et Expériences absentes");
  const src = F4_FILES.map((f) => read(f)).join("\n");
  const literal = [...src.matchAll(/\bt\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const dyn = [...src.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)].map((m) => m[1]);
  const navLabels = [...src.matchAll(/label\("([^"]+)"\)/g)].map((m) => m[1]);
  const missingLit = [...new Set([...literal, ...navLabels])].filter((k) => !enKeys.has(k));
  ok(missingLit.length === 0, `toute clé littérale utilisée existe dans en.js${missingLit.length ? " — absentes : " + missingLit.join(", ") : ""}`);
  const families = [...new Set(dyn)];
  ok(families.every((p) => [...enKeys].some((k) => k.startsWith(p))), `chaque famille dynamique (${families.join(" | ")}) a des clés dans en.js`);
  const calcIds = [...new Set(KPI_DEFS.flatMap((d) => d.calc.map(([, id]) => id)))];
  const need = [
    ...KPI_DEFS.flatMap((d) => [`overview.kpi.${d.id}.label`, `overview.kpi.${d.id}.help`]),
    ...calcIds.map((i) => `overview.calc.input.${i}`),
    ...["revenue", "margins", "acquisition"].map((g) => `overview.section.${g}`),
    ...["test", "draft", "cancelled", "gift_card_only", "b2b", "legacy"].map((r) => `overview.excluded.${r}`),
    ...["ads", "sessions", "customers"].map((s) => `overview.status.unavailable.${s}`),
    ...["orders", "known_orders", "sessions", "checkout_sessions", "first_orders", "attributed_orders", "customers", "months", "orders_out_of_window", "delivered", "shipped", "sales_days", "days"].map((m) => `overview.missing.${m}`),
    ...["no_ad_source", "no_fixed_costs", "provisional", "known_share"].map((n) => `overview.note.${n}`),
    ...["legacy_orders", "unknown_cost_lines", "unconfirmed_fees", "unconfirmed_shipping", "no_packaging_cost", "capped", "excluded"].map((g) => `overview.gaps.${g}`),
    ...SECTIONS.map((s) => `nav.${s.id}`),
    ...["steer", "explore", "system"].map((g) => `nav.group.${g}`),
    ...OVERVIEW_RESERVED.map((s) => `overview.reserved.${s.id}`),
    ...["results", "situation", "priorities", "opportunity", "chart", "waterfall", "health", "all"].map((b) => `overview.block.${b}`),
    ...["ca_ht", "cm2", "net_result"].map((r) => `results.${r}.label`),
    ...["data", "engine", "intelligence", "simulator", "results"].flatMap((s) => [`overview.engine.${s}.title`, `overview.engine.${s}.b1`, `overview.engine.${s}.b2`, `overview.engine.${s}.b3`]),
  ];
  const missingDyn = need.filter((k) => !enKeys.has(k));
  ok(missingDyn.length === 0, `membres des familles dynamiques présents (${need.length})${missingDyn.length ? " — absents : " + missingDyn.join(", ") : ""}`);
  const used = new Set([...literal, ...navLabels, ...need]);
  // Préfixes réservés à la couche narrative I0 (consommés par le lot 27, écrans en I0-B).
  const RESERVED = ["insight.", "learn.kpi.", "situation.", "confidence.", "factor.", "reference.", "cta.", "impact.", "unlock.", "assumption.", "reason.", "health.rule.", "health.unlock.", "health.level.", "results.gap.", "evidence."];
  const orphan = [...enKeys].filter((k) => !used.has(k) && !families.some((p) => k.startsWith(p)) && !RESERVED.some((p) => k.startsWith(p)));
  ok(orphan.length === 0, `aucune clé orpheline dans en.js${orphan.length ? " — " + orphan.join(", ") : ""}`);
}

// ── 4. Lint : aucune chaîne en dur dans app/ hors liste d'exclusion (C9b) ; aucune couleur hors CSS ──
console.log("\n── 4. Lint i18n : aucune chaîne en dur (JSX) hors exclusions ──");
const CSS = read("app/styles/overview.css");
{
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
    if (!/<[a-z]|<[A-Z]\w*/.test(s) || !/from "react/.test(s) && !/jsx/.test(f)) continue;
    s.split("\n").forEach((line, i) => {
      if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;
      for (const m of line.matchAll(/(?:<[A-Za-z][\w.-]*(?:\s[^<>]*)?|<\/[\w.-]+)>([^<>{}]*[A-Za-zÀ-ÿ]{2,}[^<>{}]*)</g)) offenders.push(`${f}:${i + 1} texte « ${m[1].trim().slice(0, 40)} »`);
      for (const m of line.matchAll(/\b(heading|label|placeholder|accessibilityLabel|title|alt)="([^"]*[A-Za-zÀ-ÿ]{2,}[^"]*)"/g)) offenders.push(`${f}:${i + 1} ${m[1]}=« ${m[2].slice(0, 40)} »`);
    });
  }
  ok(files.some((f) => f === "app/routes/app.overview.jsx") && files.some((f) => f === "app/routes/app.jsx"), `fichiers F4 scannés (${files.length} fichiers app/ hors exclusions)`);
  ok(offenders.length === 0, `aucune chaîne en dur${offenders.length ? "\n      " + offenders.slice(0, 12).join("\n      ") : ""}`);
  const ui = F4_FILES.filter((f) => f.startsWith("app/components/overview/") || f.startsWith("app/components/settings/") || f.startsWith("app/components/simulator/") || f === "app/routes/app.overview.jsx");
  const bad = ui.filter((f) => /style=\{\{|#[0-9a-fA-F]{6}\b|rgba?\(/.test(read(f)));
  ok(bad.length === 0, `aucun style inline, aucune couleur (hex/rgb) dans les composants de l'Overview${bad.length ? " — " + bad.join(", ") : ""}`);
  const badImp = [...ui, "app/routes/app.jsx", "app/lib/overview.js", "app/lib/overview.server.js", "app/lib/econ/adapters.js"].filter((f) => /engine\.js|orderHistory\.js|toLocaleDateString|"fr-FR"/.test(read(f)));
  ok(badImp.length === 0, `aucun import d'engine.js / orderHistory.js ni fr-FR en dur dans les fichiers F4${badImp.length ? " — " + badImp.join(", ") : ""}`);
  ok(!/shopify\.config\.locale/.test(F4_FILES.map(read).join("")), "la locale rendue ne vient jamais d'App Bridge côté client (pas de mismatch d'hydratation)");
  ok(!/<s-button-group|<s-grid/.test(ui.map(read).join("")), "plus aucune dépendance à s-grid / s-button-group (retours 2 et 3)");
  ok(/aria-current=\{n === days \? "page"/.test(read("app/components/overview/OverviewHeader.jsx")), "sélecteur de période : liens + aria-current=\"page\" (retour 3)");
  // C12 : aucun bouton principal violet ; l'accent ne remplit ni .tcc-cta ni l'actif du segmenté.
  const ctaBlock = CSS.slice(CSS.indexOf(".tcc-cta {"), CSS.indexOf("}", CSS.indexOf(".tcc-cta {")));
  ok(!/background:\s*var\(--tcc-accent\)/.test(ctaBlock) && /color:\s*var\(--tcc-accent-ink\)/.test(ctaBlock), "C12 : .tcc-cta est un lien neutre (surface, encre accent), pas un bouton plein violet");
  const segActive = CSS.slice(CSS.indexOf('.tcc-seg a[aria-current="page"]'), CSS.indexOf("}", CSS.indexOf('.tcc-seg a[aria-current="page"]')));
  ok(/background:\s*var\(--tcc-surface\)/.test(segActive) && !/--tcc-accent\)/.test(segActive), "C12 : période active neutre (surface + encre), pas d'aplat violet");
  ok(!/background:\s*var\(--tcc-accent\)\s*;/.test(CSS.replace(/\/\*[\s\S]*?\*\//g, "")), "C12 : aucun fond plein --tcc-accent dans toute la feuille");
}

// ── 5. Jetons CSS : contrastes AA calculés, thème sombre complet, mouvement réduit, logique ──
console.log("\n── 5. app/styles/overview.css : jetons --tcc-*, contrastes, sombre, mouvement, RTL ──");
{
  const block = (sel) => { const i = CSS.indexOf(sel); const s = CSS.indexOf("{", i); let depth = 0, j = s; for (; j < CSS.length; j++) { if (CSS[j] === "{") depth++; if (CSS[j] === "}") { depth--; if (depth === 0) break; } } return CSS.slice(s, j); };
  const tokens = (txt) => Object.fromEntries([...txt.matchAll(/--tcc-([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2].toLowerCase()]));
  const light = tokens(block("\n.tcc {"));
  const dark = tokens(block('.tcc[data-theme="dark"]'));
  const darkMedia = tokens(block(".tcc:not([data-theme=\"light\"])"));
  const colorNames = Object.keys(light);
  ok(colorNames.length >= 30, `${colorNames.length} jetons de couleur définis dans .tcc (clair)`);
  ok(colorNames.every((k) => dark[k]) && Object.keys(dark).every((k) => light[k]), "thème sombre : exactement les mêmes jetons de couleur que le clair");
  ok(colorNames.every((k) => darkMedia[k] === dark[k]), "bloc prefers-color-scheme: dark identique au bloc data-theme=\"dark\"");
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
  const PAIRS = [
    ["ink", "surface"], ["ink-2", "surface"], ["ink-3", "surface"], ["ink", "surface-2"], ["ink-2", "surface-2"], ["ink", "page"], ["ink-2", "page"],
    ["accent-ink", "surface"], ["accent-ink", "surface-2"], ["accent-contrast", "accent"], ["accent-ink", "accent-soft"],
    ...["revenue", "margins", "acquisition", "good", "warn", "bad", "neutral"].flatMap((s) => [[`${s}-ink`, `${s}-soft`], [`${s}-ink`, "surface"]]),
  ];
  for (const [mode, tk] of [["clair", light], ["sombre", dark]]) {
    const fails = PAIRS.map(([fg, bg]) => [fg, bg, ratio(tk[fg], tk[bg])]).filter(([, , r]) => r < 4.5);
    ok(fails.length === 0, `${mode} : ${PAIRS.length} paires encre/fond ≥ 4,5:1 (AA)${fails.length ? " — sous le seuil : " + fails.map(([f, b, r]) => `${f}/${b} ${r.toFixed(2)}`).join(", ") : ""}`);
    const ui = ["revenue", "margins", "acquisition", "good", "warn", "bad", "accent"].map((s) => [s, ratio(tk[s], tk.surface)]).filter(([, r]) => r < 3);
    ok(ui.length === 0, `${mode} : teintes de section/état ≥ 3:1 sur la surface (éléments d'interface)${ui.length ? " — " + ui.map(([s, r]) => `${s} ${r.toFixed(2)}`).join(", ") : ""}`);
  }
  const rm = block("@media (prefers-reduced-motion: reduce)");
  ok(/animation:\s*none/.test(rm) && /transition:\s*none/.test(rm), "prefers-reduced-motion : animations et transitions neutralisées");
  const importantOutside = (CSS.replace(rm, "").match(/!important/g) ?? []).length;
  ok(importantOutside === 0, "aucun !important hors du bloc mouvement réduit");
  ok(!/\b(margin|padding|border)-(left|right)\s*:|(^|[^-\w])(left|right)\s*:|text-align:\s*(left|right)|float:/m.test(CSS), "propriétés logiques uniquement (RTL-ready) : aucune valeur left/right");
  ok(/transition:[^;]*\b(transform|opacity|background-color|color|box-shadow)\b/.test(CSS) && !/transition:[^;]*\b(width|height|top|margin)\b/.test(CSS), "transitions sur transform/opacity/couleurs seulement");
  ok(/font-variant-numeric:\s*tabular-nums/.test(CSS) && /"Inter"/.test(CSS), "chiffres en tabular-nums, police Inter (déjà chargée)");
  ok(/repeat\(4, minmax\(0, 1fr\)\)/.test(CSS) && /repeat\(2, minmax\(0, 1fr\)\)/.test(CSS) && /@container tcc-group \(max-width: 480px\)/.test(CSS), "grille app-owned 4 / 2 / 1 colonnes par container queries (retour 2)");
  // Piège des container queries (retour iPhone) : une règle @container ne peut styler que des
  // DESCENDANTS du conteneur ; le sélecteur qui porte container-name ne doit jamais être ciblé
  // dans son propre bloc @container, et chaque @container doit nommer un conteneur déclaré.
  const containers = [...CSS.matchAll(/^([^@{}\n]+)\{[^}]*container-name:\s*([\w-]+)/gm)].map((m) => ({ selectors: m[1].split(",").map((s) => s.trim()), name: m[2] }));
  const cqBlocks = [...CSS.matchAll(/@container\s+([\w-]+)?\s*\([^)]*\)\s*\{((?:[^{}]*\{[^}]*\})*)/g)].map((m) => ({ name: m[1] ?? null, body: m[2] }));
  const unnamed = cqBlocks.filter((b) => !b.name);
  ok(unnamed.length === 0, `chaque @container nomme son conteneur (${cqBlocks.length} blocs)`);
  const unknown = cqBlocks.filter((b) => b.name && !containers.some((c) => c.name === b.name));
  ok(unknown.length === 0, `chaque @container vise un conteneur déclaré${unknown.length ? " — " + unknown.map((b) => b.name).join(", ") : ""}`);
  const selfTargets = [];
  for (const b of cqBlocks) {
    const c = containers.find((x) => x.name === b.name); if (!c) continue;
    const inner = [...b.body.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));
    // Cible interdite : le conteneur lui-même, ou un modificateur BEM du même bloc (.x--y porte aussi .x).
    const own = c.selectors.map((s) => new RegExp("^" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(--[\\w-]+)?(\\.[\\w-]+)*$"));
    for (const s of inner) if (own.some((re) => re.test(s))) selfTargets.push(`${b.name}: ${s}`);
  }
  ok(selfTargets.length === 0, `aucune @container ne cible son propre conteneur${selfTargets.length ? " — " + selfTargets.join(", ") : ""}`);
  ok(/\.tcc svg:not\(\.tcc-spark\)\s*\{[^}]*inline-size: 1em/.test(CSS), "toute icône SVG a une taille par défaut (retour : icône géante du pied du moteur)");
  ok(/\.tcc-slots-wrap \{[^}]*container-name: tcc-slots/.test(CSS) && /\.tcc-engine \{[^}]*container-name: tcc-engine/.test(CSS), "emplacements réservés et bandeau du moteur : conteneur = parent, s'empilent sur conteneur étroit");
}

// ── 6. Adaptateur ligne stockée → ligne moteur (C7) ──
console.log("\n── 6. lineFromOrderMarginsRow ──");
const row1022 = { order_id: "gid://shopify/Order/1022", line_item_id: "L1", product_id: "P1", variant_id: "V1", quantity: 1, refunded_qty: 1, effective_qty: 0, unit_price_ht: 600, tax_lines: [], is_gift_card: false, cm1_components: null, cm1_unit: null, cm2_alloc: { emballage: 0, paiement: 0, port_marchand: 0 }, breakdown_version: 2, cost_source: "missing", currency_code: "USD", day_local: "2026-09-23" };
{
  const l = lineFromOrderMarginsRow(row1022);
  ok(l && l.revenue_units === 0 && l.cogs_units === 0 && l.cost_source === "missing" && l.cm1_unit === null && l.cout_rendu_unit === null, "#1022 remboursée, coût manquant : 0 unité comptée, CM1 null (jamais 0)");
  ok(l.unit_price_ttc === 600 && l.tax_per_unit === 0, "sans ligne de taxe : TTC = HT");
  ok(lineFromOrderMarginsRow({ ...row1022, breakdown_version: null, unit_price_ht: null }) === null, "ligne legacy (sans breakdown_version) → null");
  const { lines, legacy: n } = linesFromOrderMarginsRows([row1022, { ...row1022, line_item_id: "L2", breakdown_version: null }]);
  ok(lines.length === 1 && n === 1, "lot : 1 convertie, 1 legacy comptée");
  const taxed = lineFromOrderMarginsRow({ ...row1022, quantity: 2, refunded_qty: 0, effective_qty: 2, unit_price_ht: 100, tax_lines: [{ amount: 40 }], cm1_unit: 83.2, cost_source: "confirmed" });
  ok(close(taxed.tax_per_unit, 20) && close(taxed.unit_price_ttc, 120) && close(taxed.cout_rendu_unit, 16.8) && taxed.revenue_units === 2 && taxed.cogs_units === 2, "avec taxes : tax/unité 20, TTC 120, coût rendu = HT − CM1 = 16,80");
  ok(lineFromOrderMarginsRow({ ...row1022, is_gift_card: true, cm1_unit: 5 }).cost_source === "excluded", "carte cadeau → exclue");
}

// ── 7. ordersForEngine : C6 + retour 1 (commande sans ligne analysable → legacy, comptée) ──
console.log("\n── 7. ordersForEngine : brouillons/tests sur demande ; sans ligne analysable → legacy ──");
const orderRows = [
  { order_id: "o1", day_local: "2026-09-10", created_at: "2026-09-10T10:00:00Z", excluded_reason: "draft", currency_code: "USD", discounts_amount: 10, shipping_charged: 0 },
  { order_id: "o2", day_local: "2026-09-11", created_at: "2026-09-11T10:00:00Z", excluded_reason: "test", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 },
  { order_id: "o3", day_local: "2026-09-12", created_at: "2026-09-12T10:00:00Z", excluded_reason: "cancelled", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 },
  { order_id: "o4", day_local: "2026-09-12", created_at: "2026-09-12T10:00:00Z", excluded_reason: "b2b", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 },
  { order_id: "o5", day_local: "2026-09-13", created_at: "2026-09-13T10:00:00Z", excluded_reason: null, currency_code: "USD", discounts_amount: 5, shipping_charged: 4 },
];
const lineO5 = lineFromOrderMarginsRow({ ...row1022, order_id: "o5", quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: 100, cm1_unit: 60, cost_source: "confirmed", day_local: "2026-09-13" });
{
  const off = ordersForEngine(orderRows, { includeTestOrders: false, refunds: [{ order_id: "o5", shipping_refunded: 4, settled: true }] });
  ok(off.orders.filter((o) => !o.excluded_reason).length === 1 && off.reincluded === 0 && off.excluded.draft === 1 && off.excluded.test === 1, "désactivé : seule o5 incluse, compteurs draft/test à 1");
  ok(off.orders.find((o) => o.order_id === "o5").shipping_refunded === 4, "port remboursé rattaché depuis refunds");
  const on = ordersForEngine(orderRows, { includeTestOrders: true });
  ok(on.orders.filter((o) => !o.excluded_reason).length === 3 && on.reincluded === 2, "activé sans lignes fournies : o1 (draft) et o2 (test) réintégrées");
  ok(on.excluded.cancelled === 1 && on.excluded.b2b === 1, "cancelled et b2b restent exclues quoi qu'il arrive");
  // Retour 1 : avec les lignes fournies, o1 et o2 (sans ligne v2) deviennent « legacy », o5 reste.
  const withLines = ordersForEngine(orderRows, { includeTestOrders: true, lines: [lineO5] });
  ok(withLines.orders.filter((o) => !o.excluded_reason).map((o) => o.order_id).join(",") === "o5" && withLines.excluded[LEGACY_REASON] === 2, "avec lignes : o1 et o2 sans ligne analysable → legacy (2), o5 comptée");
  ok(withLines.orders.find((o) => o.order_id === "o1").excluded_reason === LEGACY_REASON && LEGACY_REASON === "legacy", "raison interne « legacy » posée en mémoire seulement");
  const giftOnly = ordersForEngine([orderRows[4]], { lines: [{ ...lineO5, cost_source: "excluded" }] });
  ok(giftOnly.excluded.legacy === 1, "une ligne « excluded » (carte cadeau) ne rend pas la commande analysable");
  ok(DEV_INCLUDABLE_REASONS.join(",") === "draft,test", "liste C6 = draft, test");
}

// ── 8. applyOrderDiscounts (C7b) ──
console.log("\n── 8. applyOrderDiscounts ──");
const settings = { shop_country_code: "US", shop_timezone: "UTC", return_window_days: 30, packaging_cost_per_order: 0, shipping_cost_rules: { default: 0, confirmed: true }, gateway_fee_rules: [{ gateway: "*", pct: 0, fixed: 0, confirmed: true }] };
const win = { start: "2026-09-01", end: "2026-09-30" };
{
  const { orders } = ordersForEngine(orderRows, { includeTestOrders: false, lines: [lineO5] });
  const base = aggregate({ orders, lines: [lineO5], settings, window: win, now: new Date("2026-10-20T00:00:00Z") });
  ok(close(base.shop.nodes.ca_ht, 104) && close(base.shop.leaves.remises, 0), "sans injection : CA HT 104 (100 + 4 port client), remises 0");
  const withD = applyOrderDiscounts(base, orders, win);
  ok(close(withD.shop.leaves.remises, 5) && close(withD.shop.leaves.ca_brut, base.shop.leaves.ca_brut + 5) && close(withD.shop.nodes.ca_ht, 104), "remise de commande injectée : remises 5, CA brut +5, CA HT inchangé");
  ok(close(withD.byDay["2026-09-13"].leaves.remises, 5) && base.shop.leaves.remises === 0, "jour mis à jour ; non mutant");
  ok(applyOrderDiscounts(base, orders, { start: "2026-08-01", end: "2026-08-31" }) === base, "aucune remise dans la fenêtre → même objet");
}

// ── 9. Fenêtres : journée en cours incluse et partielle (retour 4) ──
console.log("\n── 9. overviewWindows ──");
{
  const w = overviewWindows({ now: new Date("2026-09-23T03:00:00Z"), timeZone: "America/New_York", days: 30 });
  ok(w.today === "2026-09-22" && w.current.end === "2026-09-22" && w.current.start === "2026-08-24" && w.current.partial === true, `30 j finissant AUJOURD'HUI (New York : ${w.today}), journée partielle : ${w.current.start} → ${w.current.end}`);
  ok(w.previous.end === "2026-08-23" && w.previous.start === "2026-07-25" && w.previous.partial === false, `précédente contiguë de 30 j : ${w.previous.start} → ${w.previous.end}`);
  const w7 = overviewWindows({ now: new Date("2026-09-23T12:00:00Z"), timeZone: "UTC", days: 7 });
  ok(w7.current.start === "2026-09-17" && w7.current.end === "2026-09-23" && w7.previous.start === "2026-09-10" && w7.previous.end === "2026-09-16", "7 jours UTC, #1022 du jour incluse");
  ok(parsePeriodDays("90") === 90 && parsePeriodDays("12") === 30 && parsePeriodDays(null) === 30, "parsePeriodDays : 7/30/90 seulement, sinon 30");
}

// ── 10. Statuts KPI, séries, calcul ──
console.log("\n── 10. buildKpis : vide / legacy / coûts manquants / coûts saisis ; séries ; calcul ──");
{
  const now = new Date("2026-10-20T00:00:00Z");
  const prevWin = { start: "2026-08-02", end: "2026-08-31" };
  // État 1 : les 6 commandes de juillet n'ont que des lignes legacy → toutes « legacy » → vide.
  const july = Array.from({ length: 6 }, (_, i) => ({ order_id: `j${i}`, day_local: "2026-09-05", created_at: "2026-09-05T10:00:00Z", excluded_reason: "draft", currency_code: "USD", discounts_amount: 0, shipping_charged: 0 }));
  const st1 = ordersForEngine(july, { includeTestOrders: true, lines: [] });
  const e1 = aggregate({ orders: st1.orders, lines: [], settings, window: win, now });
  const k1 = buildKpis({ current: e1, previous: aggregate({ orders: [], lines: [], settings, window: prevWin, now }), window: win });
  ok(e1.shop.leaves.orders === 0 && st1.excluded.legacy === 6, "retour 1 : 6 commandes sans ligne analysable → 0 commande comptée, 6 legacy");
  ok(k1.length === 12 && k1.filter((k) => k.primary).length === 8, "12 KPI dont 8 primaires");
  ok(k1.every((k) => k.status === "insufficient" && k.missing?.orders === 1 && k.value === null), "état vide : tous « insuffisant : encore 1 commande », jamais 0,00 affiché");
  const gaps1 = buildGaps({ agg: e1, excluded: { ...st1.excluded } });
  ok(gaps1.some((g) => g.id === "legacy_orders" && g.count === 6) && !gaps1.some((g) => g.id === "excluded"), "trou « 6 commandes lues par l'ancienne version, non comptées » ; pas listé parmi les exclusions");
  // État 2 : commande incluse, coût manquant.
  const l2 = [lineFromOrderMarginsRow({ ...row1022, order_id: "o1", quantity: 1, refunded_qty: 0, effective_qty: 1, day_local: "2026-09-10" })];
  const on = ordersForEngine(orderRows, { includeTestOrders: true, lines: l2 });
  const e2 = aggregate({ orders: on.orders, lines: l2, settings, window: win, now });
  const k2 = Object.fromEntries(buildKpis({ current: e2, previous: e1, window: win }).map((k) => [k.id, k]));
  ok(k2.ca_ht.status === "ok" && close(k2.ca_ht.value, 600) && k2.orders.value === 1 && on.excluded.legacy === 2, "état 2 : o1 seule analysable (600), o2 et o5 sans ligne → legacy");
  ok(k2.aov.status === "insufficient" && k2.aov.missing.orders === 9, "panier moyen : « encore 9 commandes »");
  ok(k2.cm3.status === "unknown" && k2.cm3.reason === "costs" && k2.cm3.unknown_cost_lines === 1, "CM3 : inconnu, 1 ligne sans coût");
  ok(k2.cvr.status === "unavailable" && k2.cvr.source === "sessions" && k2.cac_global.status === "unavailable", "CVR / CAC : sources non connectées");
  ok(k2.ca_ht.series === null, "série : une seule journée non nulle → pas de mini-courbe");
  ok(k2.ca_ht.refunds === null, "aucun remboursement → aucune sous-ligne");
  // Option A (retour 3) : #1022 vendue 600 puis remboursée 600 → vrai zéro expliqué.
  const l1022 = [lineFromOrderMarginsRow({ ...row1022, order_id: "o1", day_local: "2026-09-10" })];
  const on1022 = ordersForEngine([orderRows[0]], { includeTestOrders: true, lines: l1022 });
  const e1022 = aggregate({ orders: on1022.orders, lines: l1022, settings, window: win, now });
  const kr = Object.fromEntries(buildKpis({ current: e1022, previous: e1, window: win }).map((k) => [k.id, k]));
  ok(kr.ca_ht.status === "ok" && kr.ca_ht.value === 0 && kr.ca_ht.refunds && close(kr.ca_ht.refunds.refunded, 600) && close(kr.ca_ht.refunds.gross, 600) && kr.ca_ht.refunds.full === true, "vrai zéro : CA HT 0 « ok » avec sous-ligne 600 remboursés sur 600 vendus, intégral");
  ok(kr.orders.refunds === null && kr.aov.status === "insufficient" && !kr.aov.refunds, "sous-ligne réservée aux KPI de revenu/marge affichés (commandes : non ; panier moyen insuffisant : rien)");
  const kp = Object.fromEntries(buildKpis({ current: aggregate({ orders: [...on1022.orders, orderRows[4]], lines: [...l1022, lineO5], settings, window: win, now }), previous: e1, window: win }).map((k) => [k.id, k]));
  ok(kp.ca_ht.refunds && close(kp.ca_ht.refunds.refunded, 600) && close(kp.ca_ht.refunds.gross, 704) && kp.ca_ht.refunds.full === false, "remboursement partiel de la période : 600 sur 704 vendus, non intégral");
  // État 3 : 12 commandes à coût connu, 10 avant → séries, écarts, calcul.
  const many = Array.from({ length: 12 }, (_, i) => ({ order_id: `m${i}`, day_local: `2026-09-${String(10 + i).padStart(2, "0")}`, created_at: `2026-09-${String(10 + i).padStart(2, "0")}T10:00:00Z`, excluded_reason: null, currency_code: "USD", discounts_amount: 0, shipping_charged: 0, customer_order_index: 1 }));
  const manyLines = many.map((o) => lineFromOrderMarginsRow({ ...row1022, order_id: o.order_id, line_item_id: `L${o.order_id}`, quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: 100, cm1_unit: 60, cost_source: "confirmed", day_local: o.day_local }));
  const prevMany = many.slice(0, 10).map((o) => ({ ...o, order_id: `p${o.order_id}`, day_local: o.day_local.replace("-09-", "-08-"), created_at: o.created_at.replace("-09-", "-08-") }));
  const prevLines = prevMany.map((o) => lineFromOrderMarginsRow({ ...row1022, order_id: o.order_id, line_item_id: `L${o.order_id}`, quantity: 1, refunded_qty: 0, effective_qty: 1, unit_price_ht: 80, cm1_unit: 40, cost_source: "confirmed", day_local: o.day_local }));
  const all = { orders: [...many, ...prevMany], lines: [...manyLines, ...prevLines], settings, now };
  const cur3 = aggregate({ ...all, window: win }), prev3 = aggregate({ ...all, window: prevWin });
  const k3 = Object.fromEntries(buildKpis({ current: cur3, previous: prev3, window: win }).map((k) => [k.id, k]));
  ok(k3.cm2_pct.status === "ok" && close(k3.cm2_pct.value, 60) && k3.cm3.status === "ok" && close(k3.cm3.value, 720), "état 3 : CM2 60 %, CM3 720");
  ok(k3.ca_ht.delta?.kind === "pct" && close(k3.ca_ht.delta.value, 50) && k3.ca_ht.delta.tone === "good" && k3.ca_ht.delta.direction === "up", "écart CA HT +50 % (ton favorable, flèche haut)");
  ok(k3.cm2_pct.delta?.kind === "points" && close(k3.cm2_pct.delta.value, 10), "écart CM2 % en points : +10 pt");
  const cacDef = KPI_DEFS.find((d) => d.id === "cac_global");
  ok(kpiDelta(cacDef, 30, 40).tone === "good" && kpiDelta(cacDef, 40, 30).tone === "bad" && kpiDelta(cacDef, 30, 30).tone === "neutral", "CAC : une baisse est favorable, une hausse défavorable, égal neutre");
  ok(kpiDelta(KPI_DEFS[0], 100, 0) === null && kpiDelta(KPI_DEFS[0], null, 5) === null, "écart : base nulle ou valeur absente → null");
  ok(Array.isArray(k3.ca_ht.series) && k3.ca_ht.series.length === 30 && k3.ca_ht.series.filter((p) => p.value > 0).length === 12 && k3.ca_ht.series.every((p) => p.value != null), "série CA HT : 30 points, 12 jours > 0, jours sans commande à 0 (vrai zéro)");
  ok(k3.cm2_pct.series && k3.cm2_pct.series.some((p) => p.value == null) && k3.cm2_pct.series.filter((p) => p.value != null).length === 12, "série CM2 % : jours sans commande non définis (null), 12 définis");
  ok(k3.cac_global.series === null && kpiSeries(cur3, cacDef, win) === null, "KPI sans série journalière → pas de mini-courbe");
  const rows = calcRows(cur3, KPI_DEFS[0]);
  ok(rows.length === 5 && rows[0].id === "ca_brut" && rows[4].op === "=" && rows[4].strong && close(rows[4].value, 1200) && rows.every((r) => r.unit === "money"), "calcul CA HT : 5 lignes, « = » en gras, 1 200");
  const cm2rows = calcRows(cur3, KPI_DEFS.find((d) => d.id === "cm2_pct"));
  ok(cm2rows.at(-1).id === "cm2_pct" && cm2rows.at(-1).unit === "pct" && close(cm2rows.at(-1).value, 60) && cm2rows.find((r) => r.id === "cm2").unit === "money", "calcul CM2 % : unités par ligne (montants puis %)");
  const notes = buildNotes(cur3);
  ok(notes.some((n) => n.id === "no_ad_source") && notes.some((n) => n.id === "no_fixed_costs"), "notes : pub non connectée, coûts fixes absents");
  const gaps = buildGaps({ agg: e2, capped: true, excluded: { draft: 0, cancelled: 1, b2b: 1, legacy: 2 } });
  ok(gaps.some((g) => g.id === "unknown_cost_lines" && g.count === 1) && gaps.some((g) => g.id === "legacy_orders" && g.count === 2) && gaps.some((g) => g.id === "capped" && g.cap === OVERVIEW_LINES_CAP) && gaps.find((g) => g.id === "excluded")?.count === 2, "trous : 1 sans coût, 2 legacy, plafond, 2 exclues");
}

// ── 11. Mini-courbe (chemins SVG) ──
console.log("\n── 11. sparklinePaths ──");
{
  ok(sparklinePaths([]) === null && sparklinePaths([{ value: 1 }]) === null && sparklinePaths([{ value: null }, { value: null }]) === null, "moins de 2 points définis → null (jamais rendue)");
  const p = sparklinePaths([{ value: 0 }, { value: 10 }, { value: 5 }]);
  ok(p && p.line.startsWith("M2.0,30.0") && /Z$/.test(p.area) && (p.line.match(/L/g) ?? []).length === 2, "3 points : ligne depuis la base (0 = bas), aplat fermé");
  const gap = sparklinePaths([{ value: 1 }, { value: null }, { value: 2 }, { value: 3 }]);
  ok(gap && (gap.line.match(/M/g) ?? []).length === 2 && (gap.area.match(/Z/g) ?? []).length === 2, "jour non défini : la courbe s'interrompt (2 segments, 2 aplats)");
}

// ── 12. Navigation cible et emplacements réservés ──
console.log("\n── 12. sections.js ──");
{
  ok(SECTIONS.length === 13 && SECTIONS.map((s) => s.id).join(",") === "overview,decisions,simulator,ask,metrics,profit,growth,customers,products,marketing,inventory,data_health,settings", "13 sections en 3 groupes dans l'ordre décidé (Piloter / Explorer / Système)");
  ok(SECTIONS.filter((s) => s.group === "steer").length === 4 && SECTIONS.filter((s) => s.group === "explore").length === 7 && SECTIONS.filter((s) => s.group === "system").length === 2, "groupes : 4 / 7 / 2");
  ok(LIVE_SECTIONS.map((s) => `${s.id}:${s.path}`).join(",") === "overview:/app/overview,simulator:/app/simulator,metrics:/app/metrics,data_health:/app/data-health,settings:/app/settings", "livrées : Aujourd'hui, Simulateur (S1), Indicateurs, Fiabilité des données, Réglages (R1)");
  ok(SECTIONS.filter((s) => s.status === "soon").every((s) => s.path === null), "les sections « Bientôt » n'ont pas de route");
  ok(OVERVIEW_RESERVED.length === 2 && OVERVIEW_RESERVED.every((s) => s.section === "overview"), "2 emplacements réservés (courbe, cascade) rattachés à la Vue d'ensemble");
  ok(/rel="home"/.test(read("app/routes/app.jsx")) && /LIVE_SECTIONS/.test(read("app/routes/app.jsx")), "s-app-nav : rel=\"home\" + sections livrées seulement");
}

// ── 13. Formatage ──
console.log("\n── 13. format (Intl) ──");
{
  const fr = formatMoney(1234.5, "fr", "USD"), en = formatMoney(1234.5, "en", "USD");
  ok(fr !== en && /234/.test(fr) && en === "$1,234.50", `fr ≠ en pour la même valeur (${fr} / ${en})`);
  ok(formatMoney(10, "fr", "MIXED") === "10,00" && formatMoney(10, "en", null) === "10.00", "MIXED / devise absente → nombre neutre");
  ok(/XYZ$/.test(formatMoney(10, "fr", "XYZ")), "devise inconnue → nombre + code");
  ok(formatPct(64.7, "en") === "64.7%" && /64,7/.test(formatPct(64.7, "fr")), "pourcentage par locale");
  ok(formatDelta(12.34, "en") === "+12.3%" && formatDelta(-2.5, "en", { kind: "points" }) === "-2.5 pt" && formatDelta(0, "en") === "0.0%", "écart signé");
  ok(formatRatio(3.571, "en") === "3.57×", "ratio ×");
  ok(formatDay("2026-09-21", "en") === "Sep 21, 2026" && /21/.test(formatDay("2026-09-21", "fr")), "jour boutique sans décalage de fuseau");
  const now = new Date("2026-09-23T14:00:00Z");
  ok(formatRelative("2026-09-23T12:00:00Z", "en", now) === "2 hours ago" && /2 h/.test(formatRelative("2026-09-23T12:00:00Z", "fr", now)), "relatif : « 2 hours ago » / « il y a 2 h »");
  ok(formatRelative(null, "en", now) === null && formatMoney("abc", "en", "USD") === null, "valeurs absentes → null");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 26 (F4-A vue d'ensemble + i18n) : ✓ Tous les tests passent" : ` BILAN LOT 26 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
