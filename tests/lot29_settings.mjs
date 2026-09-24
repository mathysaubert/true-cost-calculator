// ════════════════════════════════════════════════════════════════════════════════
//  LOT 29 — Réglages (R1, S1-S10) : module pur app/lib/settings.js. Analyse des formulaires
//  (virgule, vide = NULL, bornes), port par pays, règle de passerelle, passerelles vues, coûts
//  fixes, recopie shop_plans, règle de fiabilité par intent, état des réglages ; scans statiques.
//  Pour lancer : node tests/lot29_settings.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { FIELDS, MIRROR_COLUMNS, SETTINGS_NAV, parseNumber, parseFields, shippingRulesFromForm, gatewayRuleFromForm, mergeGatewayRule, ruleFor, gatewaysFromOrders, fixedCostFromForm, isActiveFixedCost, mirrorFor, dataRuleOf, settingsStatus, presetFor } from "../app/lib/settings.js";
import { CATALOGS } from "../app/locales/index.js";

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
  ok(FIELDS.goals.find((f) => f.key === "profitability_threshold_pct").mirror === true && MIRROR_COLUMNS.includes("profitability_threshold_pct") && MIRROR_COLUMNS.length === 7, "seuil CM2 recopié vers shop_plans ; 7 colonnes miroir (S1a)");
}

console.log("\n── 2. Port par pays, passerelles, coûts fixes ──");
{
  const s = shippingRulesFromForm(fd({ shipping_default: "4,90", shipping_country_1: "fr", shipping_amount_1: "3", shipping_country_2: "", shipping_amount_2: "", shipping_country_3: "USA", shipping_amount_3: "9" }));
  ok(s.rules.default === 4.9 && s.rules.byCountry.FR === 3 && s.rules.confirmed === true && s.errors.shipping_country_3 === "invalid" && !("USA" in s.rules.byCountry), "port : défaut, pays en majuscules, ligne vide ignorée, code à 3 lettres refusé, confirmé");
  ok(shippingRulesFromForm(fd({ shipping_default: "" })).rules.default === 0 && shippingRulesFromForm(fd({ shipping_default: "-2" })).errors.shipping_default === "range", "port : défaut vide → 0 ; négatif refusé");
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
  ok(JSON.stringify(mirrorFor({ profitability_threshold_pct: 45, main_product_price: 60, vat_regime: "franchise" })) === JSON.stringify({ profitability_threshold_pct: 45, vat_regime: "franchise" }), "mirrorFor : seules les colonnes historiques partent vers shop_plans");
  ok(dataRuleOf("save_gateway") === "payment_fees" && dataRuleOf("save_shipping") === "shipping_costs" && dataRuleOf("save_order_costs") === "shipping_costs" && dataRuleOf("add_fixed_cost") === "fixed_costs" && dataRuleOf("save_goals") === null, "règle de fiabilité par intent (S10) ; objectifs = aucune");
  const st = settingsStatus({ settings: { gateway_fee_rules: [{ gateway: "paypal", pct: 3.4, fixed: 0.35, confirmed: true }], shipping_cost_rules: {}, packaging_cost_per_order: 0.3, profitability_threshold_pct: 0, main_product_price: 60 }, fixedCosts: [{ active_from: null, active_to: "2026-01-01" }], gateways: [{ gateway: "shopify_payments", orders: 5 }, { gateway: "paypal", orders: 2 }], day: "2026-09-24" });
  const by = Object.fromEntries(st.map((i) => [i.id, i.state]));
  ok(st.length === 8 && by.gateway_fees === "unconfirmed" && by.shipping === "unset" && by.packaging === "set" && by.return_cost === "unset" && by.fixed_costs === "unset" && by.cm2_target === "unset" && by.roas_target === "unset" && by.main_product_price === "set", `8 états : ${st.map((i) => `${i.id}=${i.state}`).join(" ")}`);
  ok(settingsStatus({ settings: {}, gateways: [] }).find((i) => i.id === "gateway_fees").state === "unset" && settingsStatus({ settings: { gateway_fee_rules: [{ gateway: "x", confirmed: true }] }, gateways: [{ gateway: "x", orders: 1 }] }).find((i) => i.id === "gateway_fees").state === "set", "passerelles : aucune vue → manquant ; toutes confirmées → renseigné");
  ok(st.every((i) => ["costs", "goals"].includes(i.page)) && SETTINGS_NAV.filter((n) => n.status === "live").map((n) => n.id).join(",") === "index,costs,goals", "chaque état pointe une page livrée ; 3 pages livrées (S2)");
}

console.log("\n── 4. Catalogues et scans ──");
{
  const en = CATALOGS.en, fr = CATALOGS.fr;
  const fieldKeys = [...FIELDS.order_costs, ...FIELDS.goals].map((f) => f.key);
  ok(fieldKeys.every((k) => en[`settings.field.${k}.label`] && en[`settings.field.${k}.help`] && fr[`settings.field.${k}.label`]), "chaque champ scalaire a libellé + aide en/fr");
  ok(["gateway_fees", "shipping", "packaging", "return_cost", "fixed_costs", "cm2_target", "roas_target", "main_product_price"].every((i) => en[`settings.item.${i}`] && fr[`settings.item.${i}`]), "chaque état de réglage a son libellé");
  ok(SETTINGS_NAV.every((n) => en[`settings.nav.${n.id}`] && fr[`settings.nav.${n.id}`]) && ["set", "unset", "unconfirmed"].every((s) => en[`settings.status.${s}`]) && ["invalid", "range", "failed", "fields"].every((e) => en[`settings.error.${e}`]), "sous-nav, états, erreurs traduits");
  const pure = read("app/lib/settings.js");
  ok(!/supabase|fetch\(|import\s+.*react|Date\.now\(|new Date\(/i.test(pure), "settings.js : aucune I/O, aucun React, aucune date courante");
  const server = read("app/lib/settings.server.js");
  ok(/from\("shop_settings"\)\.upsert/.test(server) && /from\("shop_plans"\)\.upsert/.test(server) && /mirrorFor/.test(server), "serveur : écrit shop_settings puis recopie shop_plans (S1a)");
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
