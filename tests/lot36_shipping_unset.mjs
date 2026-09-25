// ════════════════════════════════════════════════════════════════════════════════
//  LOT 36 — Règle « un réglage effacé reste non renseigné » : port marchand par défaut (2026-09-25).
//  Vide → null (jamais 0 €), non confirmé ; le moteur (econ/aggregate.orderCosts, intouché) compte
//  alors le port facturé au client, signalé « à confirmer » ; 0 saisi = vrai choix de 0 € confirmé.
//  Pour lancer : node tests/lot36_shipping_unset.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { shippingRulesFromForm, shippingState, settingsStatus } from "../app/lib/settings.js";
import { orderCosts } from "../app/lib/econ/aggregate.js";
import { unitDefaultsFromSettings } from "../app/lib/simulator/newProduct.js";
import { auditAssumptions } from "../app/lib/products.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const fd = (o) => ({ get: (k) => (k in o ? o[k] : null) });
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const order = { order_id: "o1", total_ttc: 64.9, shipping_charged: 4.9, country_code: "BE", gateway_names: ["shopify_payments"] };

console.log("\n── 1. Formulaire ──");
{
  const empty = shippingRulesFromForm(fd({ shipping_default: "" })).rules;
  ok(empty.default === null && empty.confirmed === false && Object.keys(empty.byCountry).length === 0, "tout vide → port par défaut non renseigné (null), règle non confirmée");
  const zero = shippingRulesFromForm(fd({ shipping_default: "0" })).rules;
  ok(zero.default === 0 && zero.confirmed === true, "0 saisi → vrai choix de 0 €, confirmé");
  const countries = shippingRulesFromForm(fd({ shipping_default: "", shipping_country_1: "fr", shipping_amount_1: "3" })).rules;
  ok(countries.default === null && countries.byCountry.FR === 3 && countries.confirmed === true, "surcharge par pays seule → défaut non renseigné, surcharges confirmées");
}

console.log("\n── 2. État affiché (badge, mise en route) ──");
{
  ok(shippingState({ default: 4.9, confirmed: true }) === "set" && shippingState({ default: 0, confirmed: true }) === "set", "défaut confirmé (même 0 €) → Renseigné");
  ok(shippingState({ default: null, byCountry: { FR: 3 }, confirmed: true }) === "unconfirmed" && shippingState({ default: 5, confirmed: false }) === "unconfirmed", "surcharges seules, ou règle non confirmée → À confirmer");
  ok(shippingState({ default: null, byCountry: {}, confirmed: false }) === "unset" && shippingState({}) === "unset" && shippingState(null) === "unset", "rien → Manquant");
  const st = (sr) => settingsStatus({ settings: { shipping_cost_rules: sr } }).find((x) => x.id === "shipping").state;
  ok(st({ default: null, byCountry: {}, confirmed: true }) === "unset" && st({ default: 4, confirmed: true }) === "set", "mise en route : une règle « confirmée » sans montant ne compte plus comme renseignée");
}

console.log("\n── 3. Calcul (moteur econ intouché) ──");
{
  const unset = orderCosts({ order, settings: { shipping_cost_rules: shippingRulesFromForm(fd({ shipping_default: "" })).rules } });
  ok(unset.shipping_cost === 4.9 && unset.shippingConfirmed === false && unset.gaps.includes("unconfirmed_shipping"), "port non renseigné → port facturé au client (4,90 €), signalé « à confirmer »");
  const zero = orderCosts({ order, settings: { shipping_cost_rules: shippingRulesFromForm(fd({ shipping_default: "0" })).rules } });
  ok(zero.shipping_cost === 0 && zero.shippingConfirmed === true && !zero.gaps.includes("unconfirmed_shipping"), "0 € choisi → 0 €, confirmé (plus d'effacement silencieux vers 0)");
  const fr = orderCosts({ order: { ...order, country_code: "FR" }, settings: { shipping_cost_rules: shippingRulesFromForm(fd({ shipping_default: "", shipping_country_1: "FR", shipping_amount_1: "3" })).rules } });
  const be = orderCosts({ order, settings: { shipping_cost_rules: shippingRulesFromForm(fd({ shipping_default: "", shipping_country_1: "FR", shipping_amount_1: "3" })).rules } });
  ok(fr.shipping_cost === 3 && fr.shippingConfirmed === true && be.shipping_cost === 4.9 && be.shippingConfirmed === false, "surcharge FR confirmée (3 €) ; commande BE sans règle → port facturé, à confirmer");
}

console.log("\n── 4. Simulateur et audit ──");
{
  const s = { shipping_cost_rules: shippingRulesFromForm(fd({ shipping_default: "" })).rules };
  ok(unitDefaultsFromSettings(s).shipping === undefined && auditAssumptions(s).includes("shipping"), "port non renseigné : pas de pré-remplissage (nouveau produit), listé « non renseigné » par l'audit");
  ok(unitDefaultsFromSettings({ shipping_cost_rules: { default: 0, confirmed: true } }).shipping === "0", "0 € choisi : repris tel quel");
}

console.log("\n── 5. Branchements ──");
{
  const route = read("app/routes/app.settings.costs.jsx");
  ok(/if \(!rules\.confirmed\) return \{ intent, \.\.\.\(await saveShippingRules/.test(route), "enregistrement vide : aucune « donnée corrigée » écrite au journal des décisions");
  ok(/SHIPPING_TONE\[shipState\]/.test(read("app/components/settings/CostsForms.jsx")), "badge du formulaire Port = shippingState (3 états)");
  ok(read("package.json").includes("lot36_shipping_unset"), "lot 36 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 36 (port non renseigné) : ✓ Tous les tests passent" : ` BILAN LOT 36 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
