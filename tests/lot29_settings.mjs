// ════════════════════════════════════════════════════════════════════════════════
//  LOT 29 — Réglages (R1, S1-S10) : module pur app/lib/settings.js. Analyse des formulaires
//  (virgule, vide = NULL, bornes), port par pays, règle de passerelle, passerelles vues, coûts
//  fixes, recopie shop_plans, règle de fiabilité par intent, état des réglages ; scans statiques.
//  Pour lancer : node tests/lot29_settings.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { parseShopForm, parseCountryList, partnerFromForm, promoRuleFromForm, manualCommissionFromForm, codesFromOrders, connectionsStatus, SHOP_FIELDS, PROVIDERS, FIELDS, SETTINGS_NAV, parseNumber, parseFields, shippingRulesFromForm, gatewayRuleFromForm, mergeGatewayRule, ruleFor, gatewaysFromOrders, fixedCostFromForm, isActiveFixedCost, dataRuleOf, settingsStatus, presetFor } from "../app/lib/settings.js";
import { CATALOGS } from "../app/locales/index.js";
import { settingsPathForRule, activationChecklist, RULE_PAGES, COSTS_DONE_SHARE } from "../app/lib/activation.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

console.log("\n── 1. Nombres et champs scalaires ──");
{
  ok(parseNumber("1 234,5") === 1234.5 && parseNumber("0.25") === 0.25 && parseNumber("") === null && parseNumber(null) === null && parseNumber("abc") === undefined && parseNumber("1,2,3") === undefined, "virgule française, espaces, vide → NULL, texte → invalide");
  const r = parseFields(FIELDS.order_costs, fd({ packaging_cost_per_order: "0,35", return_cost_per_return: "", return_window_days: "14", delivery_promise_days: "x" }));
  ok(r.values.packaging_cost_per_order === 0.35 && r.values.return_cost_per_return === null && r.values.return_window_days === 14 && r.errors.delivery_promise_days === "invalid" && !("delivery_promise_days" in r.values), "coûts de commande : montant arrondi, vide → NULL, entier, invalide signalé et non écrit");
  ok(parseFields(FIELDS.order_costs, fd({ return_window_days: "2.5" })).errors.return_window_days === "invalid", "jours : un décimal est invalide");
  ok(parseFields(FIELDS.goals, fd({ profitability_threshold_pct: "120" })).errors.profitability_threshold_pct === "range" && parseFields(FIELDS.goals, fd({ main_product_price: "-1" })).errors.main_product_price === "range", "bornes : 120 % et prix négatif refusés");
  ok(Object.keys(parseFields(FIELDS.goals, fd({})).values).length === 0, "champ absent du formulaire → non touché");
  ok(FIELDS.goals.every((f) => f.mirror === undefined) && FIELDS.order_costs.every((f) => f.mirror === undefined), "D2-3 : plus aucun champ recopié vers shop_plans");
}

console.log("\n── 2. Port par pays, passerelles, coûts fixes ──");
{
  const s = shippingRulesFromForm(fd({ shipping_default: "4,90", shipping_country_1: "fr", shipping_amount_1: "3", shipping_country_2: "", shipping_amount_2: "", shipping_country_3: "USA", shipping_amount_3: "9" }));
  ok(s.rules.default === 4.9 && s.rules.byCountry.FR === 3 && s.rules.confirmed === true && s.errors.shipping_country_3 === "invalid" && !("USA" in s.rules.byCountry), "port : défaut, pays en majuscules, ligne vide ignorée, code à 3 lettres refusé, confirmé");
  ok(shippingRulesFromForm(fd({ shipping_default: "" })).rules.default === null && shippingRulesFromForm(fd({ shipping_default: "" })).rules.confirmed === false && shippingRulesFromForm(fd({ shipping_default: "-2" })).errors.shipping_default === "range", "port : défaut vide → non renseigné (null, non confirmé), jamais 0 ; négatif refusé");
  const g = gatewayRuleFromForm(fd({ gateway: "shopify_payments", pct: "1,5", fixed: "0.25" }));
  ok(g.rule.gateway === "shopify_payments" && g.rule.pct === 1.5 && g.rule.fixed === 0.25 && g.rule.confirmed === true && !Object.keys(g.errors).length, "règle de passerelle confirmée à la sauvegarde");
  ok(gatewayRuleFromForm(fd({ gateway: "", pct: "", fixed: "50" })).errors.gateway === "invalid" && gatewayRuleFromForm(fd({ gateway: "x", pct: "", fixed: "50" })).errors.pct === "invalid" && gatewayRuleFromForm(fd({ gateway: "x", pct: "1", fixed: "50" })).errors.fixed === "range", "règle : passerelle, taux vide, fixe hors borne");
  const merged = mergeGatewayRule([{ gateway: "paypal", pct: 3.4, fixed: 0.35, confirmed: true }, { gateway: "shopify_payments", pct: 2, fixed: 0.3, confirmed: false }], g.rule);
  ok(merged.length === 2 && ruleFor(merged, "shopify_payments").pct === 1.5 && ruleFor(merged, "paypal").pct === 3.4 && merged[0].gateway === "paypal", "fusion : remplace la règle de la même passerelle, garde les autres, triée");
  ok(mergeGatewayRule(null, g.rule).length === 1 && ruleFor(undefined, "x") === null, "règles absentes → liste d'une règle ; ruleFor tolérant");
  const gw = gatewaysFromOrders([{ gateway_names: ["shopify_payments"] }, { gateway_names: ["paypal", "shopify_payments"] }, { gateway_names: [] }, {}, { gateway_names: ["bogus"] }]);
  ok(gw.map((x) => `${x.gateway}:${x.orders}`).join(",") === "shopify_payments:2,bogus:1,paypal:1", "passerelles vues : comptées puis triées par nom à égalité");
  ok(presetFor("shopify_payments").pct === 1.5 && presetFor("PayPal Express").pct === 3.4 && presetFor("bogus").pct === 0 && presetFor("autre").pct === 2, "valeurs courantes par passerelle (placeholders)");
  const fc = fixedCostFromForm(fd({ label: "  Loyer ", amount_monthly: "1 200,50", active_from: "2026-09-01", active_to: "" }));
  ok(fc.row.label === "Loyer" && fc.row.amount_monthly === 1200.5 && fc.row.active_from === "2026-09-01" && fc.row.active_to === null && !Object.keys(fc.errors).length, "coût fixe : libellé nettoyé, montant, dates");
  ok(fixedCostFromForm(fd({ label: "", amount_monthly: "x", active_from: "01/09/2026", active_to: "" })).errors.label === "invalid" && fixedCostFromForm(fd({ label: "a", amount_monthly: "1", active_from: "2026-09-10", active_to: "2026-09-01" })).errors.active_to === "range", "coût fixe : libellé vide, montant invalide, date non ISO, fin avant début");
  ok(isActiveFixedCost({ active_from: null, active_to: null }, "2026-09-24") && isActiveFixedCost({ active_from: "2026-09-01", active_to: "2026-09-24" }, "2026-09-24") && !isActiveFixedCost({ active_from: null, active_to: "2026-09-23" }, "2026-09-24"), "coût fixe actif : bornes incluses");
}

console.log("\n── 3. Recopie, fiabilité, état des réglages ──");
{
  ok(!/MIRROR_COLUMNS|mirrorFor/.test(readFileSync(new URL("../app/lib/settings.js", import.meta.url), "utf8")), "D2-3 : MIRROR_COLUMNS et mirrorFor retirés");
  ok(dataRuleOf("save_gateway") === "payment_fees" && dataRuleOf("save_shipping") === "shipping_costs" && dataRuleOf("save_order_costs") === "shipping_costs" && dataRuleOf("add_fixed_cost") === "fixed_costs" && dataRuleOf("save_goals") === null, "règle de fiabilité par intent (S10) ; objectifs = aucune");
  const st = settingsStatus({ settings: { gateway_fee_rules: [{ gateway: "paypal", pct: 3.4, fixed: 0.35, confirmed: true }], shipping_cost_rules: {}, packaging_cost_per_order: 0.3, profitability_threshold_pct: 0, main_product_price: 60 }, fixedCosts: [{ active_from: null, active_to: "2026-01-01" }], gateways: [{ gateway: "shopify_payments", orders: 5 }, { gateway: "paypal", orders: 2 }], day: "2026-09-24" });
  const by = Object.fromEntries(st.map((i) => [i.id, i.state]));
  ok(st.length === 13 && by.shop_country === "unset" && by.partners === "unset" && by.ads_connection === "unset" && by.gateway_fees === "unconfirmed" && by.shipping === "unset" && by.packaging === "set" && by.return_cost === "unset" && by.fixed_costs === "unset" && by.cm2_target === "unset" && by.roas_target === "unset" && by.main_product_price === "set", `13 états : ${st.map((i) => `${i.id}=${i.state}`).join(" ")}`);
  ok(settingsStatus({ settings: {}, gateways: [] }).find((i) => i.id === "gateway_fees").state === "unset" && settingsStatus({ settings: { gateway_fee_rules: [{ gateway: "x", confirmed: true }] }, gateways: [{ gateway: "x", orders: 1 }] }).find((i) => i.id === "gateway_fees").state === "set", "passerelles : aucune vue → manquant ; toutes confirmées → renseigné");
  ok(st.every((i) => ["costs", "goals", "shop", "marketing", "connections"].includes(i.page)) && SETTINGS_NAV.filter((n) => n.status === "live").map((n) => n.id).join(",") === "index,costs,products,goals,shop,marketing,connections,plan", "chaque état pointe une page livrée ; 8 pages livrées (S2, R2, F4-D1a, F4-D1b)");
  const st2 = settingsStatus({ settings: { shop_country_code: "FR", sales_countries: ["FR", "DE"] }, partners: [{ id: "p" }], promoRules: [{ code: "X" }], connections: [{ id: "meta", status: "error" }] });
  const by2 = Object.fromEntries(st2.map((i) => [i.id, i.state]));
  ok(by2.shop_country === "set" && by2.sales_countries === "set" && by2.partners === "set" && by2.promo_rules === "set" && by2.ads_connection === "unconfirmed", "R2 : états Boutique / Marketing / Connexions (erreur de connexion = à confirmer)");
}

console.log("\n── 3b. R2 : Boutique, Marketing, Connexions ──");
{
  ok(parseCountryList("fr, de ; US") .join(",") === "FR,DE,US" && parseCountryList("") === null && parseCountryList("FRA") === undefined && parseCountryList("FR FR").length === 1, "liste de pays : séparateurs, majuscules, vide → NULL, code à 3 lettres → invalide, dédoublonnée");
  const s = parseShopForm(fd({ shop_country_code: "fr", vat_regime: "franchise", b2b_tag: " Pro ", history_months: "12", locale_override: "fr", report_locale: "", sales_countries: "FR, BE", shipping_countries: "", supply_countries: "CN" }));
  ok(s.values.shop_country_code === "FR" && s.values.vat_regime === "franchise" && s.values.b2b_tag === "pro" && s.values.history_months === 12 && s.values.locale_override === "fr" && s.values.report_locale === null && s.values.sales_countries.join(",") === "FR,BE" && s.values.shipping_countries === null && s.values.supply_countries.join(",") === "CN" && !Object.keys(s.errors).length, "Boutique : pays en majuscules, TVA, étiquette normalisée, historique entier, langues, listes de pays");
  const bad = parseShopForm(fd({ shop_country_code: "FRA", vat_regime: "autre", history_months: "0", locale_override: "xx", sales_countries: "F1" }));
  ok(bad.errors.shop_country_code === "invalid" && bad.errors.vat_regime === "invalid" && bad.errors.history_months === "range" && bad.errors.locale_override === "invalid" && bad.errors.sales_countries === "invalid", "Boutique : chaque champ invalide est signalé");
  ok(!("history_months" in parseShopForm(fd({ history_months: "" })).values), "historique vide → inchangé (colonne NOT NULL)");
  ok(SHOP_FIELDS.find((f) => f.key === "vat_regime").mirror === undefined, "régime de TVA : écrit dans shop_settings seulement (D2-3)");
  const p = partnerFromForm(fd({ name: "  Influ ", mode: "manual" }));
  ok(p.row.name === "Influ" && p.row.mode === "manual" && partnerFromForm(fd({ name: "", mode: "x" })).errors.name === "invalid" && partnerFromForm(fd({ name: "a", mode: "x" })).errors.mode === "invalid", "partenaire : nom nettoyé, mode validé");
  const partners = [{ id: "p1", name: "A", mode: "codes" }, { id: "p2", name: "B", mode: "manual" }];
  const r = promoRuleFromForm(fd({ code: "test20", partner_id: "p1", commission_pct: "12,5", commission_base: "ht_before_discount", active_from: "2026-09-01", active_to: "" }), partners);
  ok(r.row.code === "TEST20" && r.row.partner_id === "p1" && r.row.commission_pct === 12.5 && r.row.commission_base === "ht_before_discount" && r.row.active_from === "2026-09-01" && r.row.active_to === null && !Object.keys(r.errors).length, "règle de code : code en majuscules, partenaire, taux, base, dates");
  const rb = promoRuleFromForm(fd({ code: "", partner_id: "zz", commission_pct: "150", commission_base: "x", active_from: "2026-09-10", active_to: "2026-09-01" }), partners);
  ok(rb.errors.code === "invalid" && rb.errors.partner_id === "invalid" && rb.errors.commission_pct === "range" && rb.errors.commission_base === "invalid" && rb.errors.active_to === "range", "règle de code : erreurs signalées");
  const m = manualCommissionFromForm(fd({ partner_id: "p2", period_month: "2026-09", amount: "250,5", note: "" }), partners);
  ok(m.row.partner_id === "p2" && m.row.period_month === "2026-09" && m.row.amount === 250.5 && m.row.note === null && !Object.keys(m.errors).length, "commission manuelle : partenaire manuel, mois, montant");
  ok(manualCommissionFromForm(fd({ partner_id: "p1", period_month: "2026-13", amount: "" }), partners).errors.partner_id === "invalid" && manualCommissionFromForm(fd({ partner_id: "p2", period_month: "2026-13", amount: "x" }), partners).errors.period_month === "invalid", "commission manuelle : partenaire à codes refusé, mois invalide");
  ok(codesFromOrders([{ discount_codes: ["test20"] }, { discount_codes: ["TEST20", "welcome"] }, {}]).map((c) => `${c.code}:${c.orders}`).join(",") === "TEST20:2,WELCOME:1", "codes vus : normalisés en majuscules, comptés, triés");
  const c = connectionsStatus({ rows: [{ provider: "meta", status: "error", last_error: "token" }], lastSync: "2026-09-24T08:00:00Z", now: "2026-09-24T10:00:00Z" });
  ok(c.length === 1 + PROVIDERS.length && c[0].id === "shopify" && c[0].status === "connected" && c.find((x) => x.id === "meta").status === "error" && c.find((x) => x.id === "google_ads").status === "none", "connexions : Shopify + 4 fournisseurs, erreur et absence distinguées");
  ok(connectionsStatus({ rows: [], lastSync: "2026-09-20T08:00:00Z", now: "2026-09-24T10:00:00Z" })[0].status === "stale" && connectionsStatus({ rows: [], lastSync: null })[0].status === "none", "Shopify : synchronisation en retard après 3 jours ; jamais synchronisé");
  const ui = ["app/components/settings/ShopForm.jsx", "app/components/settings/MarketingForms.jsx", "app/components/settings/ConnectionsList.jsx"].map(read).join("\n");
  ok(!/useState|onChange=/.test(ui) && /<s-select/.test(read("app/components/settings/Fields.jsx")) && /<Form method="post"/.test(ui), "R2 : formulaires natifs, s-select non contrôlé, aucun état React");
  ok(!/shop_currency"[^>]*value=/.test(ui) && /data-readonly="shop_currency"/.test(ui), "devise : lue depuis Shopify, jamais saisie");
}

console.log("\n── 3c. R3 : barre de sauvegarde, pages par règle, activation ──");
{
  const forms = ["CostsForms", "GoalsForm", "MarketingForms", "ShopForm"].map((f) => read(`app/components/settings/${f}.jsx`)).join("\n");
  const editForms = [...forms.matchAll(/<Form [^>]*method="post"[^>]*className="[^"]*tcc-form[^"]*"[^>]*>/g)].map((m) => m[0]);
  const buttonForms = [...forms.matchAll(/<Form method="post">/g)];
  ok(editForms.length === 9 && editForms.every((f) => /data-save-bar=""/.test(f)), `R3 : ${editForms.length} formulaires d'édition portent data-save-bar (App Bridge)`);
  ok(buttonForms.length >= 5 && !/<Form method="post"[^>]*data-save-bar[^>]*>\s*<input type="hidden" name="intent" value="(delete|end)_/.test(forms), "les formulaires à bouton seul (supprimer, terminer) n'ont pas de barre de sauvegarde");
  ok(settingsPathForRule("fixed_costs").path === "/app/settings/costs" && settingsPathForRule("ads_connected").path === "/app/settings/connections" && settingsPathForRule("currency").path === "/app/settings/shop" && settingsPathForRule("cost_coverage").path === "/app/settings/products" && settingsPathForRule("landed_cost").section === "products" && settingsPathForRule("zzz").path === "/app/settings", "chaque règle de fiabilité pointe sa page (coûts par variante : Réglages > Coûts produits)");
  ok(["cost_coverage", "ads_connected", "shipping_costs", "payment_fees", "fixed_costs", "landed_cost", "currency"].every((r) => RULE_PAGES[r]), "les 7 règles de fiabilité ont une page");
  const conf = { rules: [{ id: "cost_coverage", applicable: true, measure: 0.85 }] };
  const a = activationChecklist({ lastSync: "2026-09-24T10:00:00Z", confidence: conf, briefing: { situation: [{ slot: "result" }] }, ordersInPeriod: 15 });
  ok(a.complete && a.done === 3 && a.items.map((i) => i.id).join(",") === "synced,costs,situation" && a.items[1].detail === 85, "activation : 3 jalons faits (sync, coûts ≥ 80 %, situation)");
  const b = activationChecklist({ lastSync: null, confidence: { rules: [{ id: "cost_coverage", applicable: true, measure: 0.5 }] }, briefing: null, ordersInPeriod: 0 });
  ok(!b.complete && b.done === 0 && b.items.every((i) => i.path) && b.items[1].detail === 50 && COSTS_DONE_SHARE === 0.8, "activation : rien de fait → chaque jalon a un lien ; coûts à 50 % non atteints (seuil 80 %)");
  ok(activationChecklist({}).items[1].detail === null, "coûts non applicables (aucune commande) → pas de pourcentage");
  const dh = read("app/components/overview/DataHealth.jsx");
  ok(/settingsPathForRule\(g\.id\)/.test(dh) && /settingsPathForRule\(r\.id\)/.test(dh), "Fiabilité : chaque manque (bloc et page) est relié à sa page");
  ok(/to="\/app\/settings"/.test(read("app/components/overview/Blocks.jsx")), "état vide : lien vers Réglages");
}

console.log("\n── 4. Catalogues et scans ──");
{
  const en = CATALOGS.en, fr = CATALOGS.fr;
  const fieldKeys = [...FIELDS.order_costs, ...FIELDS.goals].map((f) => f.key);
  ok(fieldKeys.every((k) => en[`settings.field.${k}.label`] && en[`settings.field.${k}.help`] && fr[`settings.field.${k}.label`]), "chaque champ scalaire a libellé + aide en/fr");
  ok(["gateway_fees", "shipping", "packaging", "return_cost", "fixed_costs", "cm2_target", "roas_target", "main_product_price"].every((i) => en[`settings.item.${i}`] && fr[`settings.item.${i}`]), "chaque état de réglage a son libellé");
  ok(SETTINGS_NAV.every((n) => en[`settings.nav.${n.id}`] && fr[`settings.nav.${n.id}`]) && ["set", "unset", "unconfirmed"].every((s) => en[`settings.status.${s}`]) && ["invalid", "range", "failed", "fields"].every((e) => en[`settings.error.${e}`]), "sous-nav, états, erreurs traduits");
  ok(SHOP_FIELDS.every((f) => en[`settings.field.${f.key}.label`] && fr[`settings.field.${f.key}.help`]) && ["shopify", ...PROVIDERS].every((p) => en[`settings.provider.${p}`]) && ["connected", "error", "revoked", "none", "stale"].every((s) => fr[`settings.conn_status.${s}`]), "R2 : champs Boutique, fournisseurs, états de connexion traduits");
  const pure = read("app/lib/settings.js");
  ok(!/supabase|fetch\(|import\s+.*react|Date\.now\(|new Date\(/i.test(pure), "settings.js : aucune I/O, aucun React, aucune date courante");
  const server = read("app/lib/settings.server.js");
  ok(/from\("shop_settings"\)\.upsert/.test(server) && !/from\("shop_plans"\)/.test(server) && !/mirrorFor/.test(server), "serveur : écrit shop_settings seulement, plus de recopie vers shop_plans (D2-3)");
  ok(/kind: "data_fixed"/.test(server) && /source: "settings"/.test(server) && /scenario->>rule_id/.test(server), "serveur : data_fixed explicite, source settings, dédoublonné par règle (S10)");
  const ui = ["app/components/settings/Fields.jsx", "app/components/settings/CostsForms.jsx", "app/components/settings/GoalsForm.jsx"].map(read).join("\n");
  ok(!/useState|onChange=/.test(ui) && /<Form method="post"/.test(ui) && /<s-text-field/.test(ui), "S3a : champs Polaris WC non contrôlés dans des formulaires natifs, aucun état React");
  ok(!/value=\{preset/.test(ui) && /placeholder=\{preset/.test(ui), "S6 : les valeurs courantes sont des placeholders, jamais des valeurs");
  ok(/fixed_costs_monthly: /.test(read("app/lib/insights/index.js")) && !/fixed_costs_monthly: null/.test(read("app/lib/insights/index.js")), "thresholds() reçoit les coûts fixes mensuels (point mort, S5)");
  ok(read("package.json").includes("lot29_settings"), "lot 29 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 29 (Réglages R1) : ✓ Tous les tests passent" : ` BILAN LOT 29 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
