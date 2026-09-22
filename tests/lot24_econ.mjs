// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Moteur économique F3 (app/lib/econ/, PUR).
//  1. Les exemples chiffrés §22 du brief, rejoués (base TTC pour les ROAS — décision A1 :
//     119 / 64,17 ≈ 1,85 ; MER sur HT : 1 / 0,15 ≈ 6,67).
//  2. Ligne : HT depuis les lignes de taxe (taxes incluses ou non), unités comptées (A2),
//     coût rendu UE via engine.js (0 diff), hors UE générique (A9), override, carte cadeau, manquant.
//  3. Agrégation : Σ produits = boutique, coût manquant EXCLU et COMPTÉ, exclusions, provisoire,
//     commissions (A7), fenêtre, marketing/UTM, retours, expédition, stock, cohortes, trous.
//  4. Allocation prorata CA HT (A5) + surcharge emballage (A4).
//  5. Seuils : non atteignable, deux versions du seuil de rentabilité.
//  6. minData : insuffisant avec le manque chiffré ; jamais 0 faute de données ; table unique.
//  7. Graphe : acyclique, entrées connues, simulateur déterministe, recherche de seuil.
//  8. engine.js : seuls computeLandedCost / CUSTOMS_RATES importés.
//  Pour lancer : node tests/lot24_econ.mjs
// ════════════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync } from "node:fs";
import {
  evaluate, topologicalOrder, NODES, LEAF_INPUTS, thresholds, simulate, findThreshold, gate, minDataFor, MIN_DATA,
  unitPrices, countedUnits, landedCostUnit, computeLineEconomics, vatRateFor, isEuCountry,
  allocateOrderCosts, aggregate, orderCommissions, businessHoursBetween, fixedCostsForWindow,
} from "../app/lib/econ/index.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 0.01) => a != null && b != null && Math.abs(a - b) <= eps;

// ── 1. Exemples §22 ──
console.log("\n── 1. Exemples chiffrés du brief (§22) ──");
{
  // 119 € TTC, TVA 20 % → 99,17 HT ; coûts variables 35 → CM2 64,17 (64,7 %) → BE-ROAS 119/64,17 ≈ 1,85 (A1 TTC).
  const v1 = evaluate({ known_ca_ht: 99.17, known_ca_ttc: 119, cogs: 35, shipping_cost: 0, packaging_cost: 0, payment_fees: 0, returns_cost: 0, known_orders: 1 });
  ok(close(v1.cm2, 64.17), `CM2 = ${v1.cm2?.toFixed(2)} (attendu 64,17)`);
  ok(close(v1.cm2_pct, 64.7, 0.1), `CM2 % = ${v1.cm2_pct?.toFixed(1)} (attendu 64,7)`);
  ok(close(v1.be_roas, 1.85, 0.01), `BE-ROAS TTC = ${v1.be_roas?.toFixed(3)} (attendu ≈ 1,85 — exemple réécrit, décision A1)`);
  // Commission 15 % du HT → 14,88 ; 24 clients → 357,12 ; CAC 14,88 ; BE-CAC 64,17 ; LTV/CAC ≈ 4,31.
  const line = { unit_price_ht: 99.1667, unit_price_original_ht: 99.1667, revenue_units: 1 };
  const c = orderCommissions({ order: { discount_codes: ["INFLU15"], created_at: "2026-08-05T00:00:00Z" }, orderLines: [line], codeRules: [{ code: "INFLU15", commission_pct: 15, commission_base: "ht_after_discount" }] });
  ok(close(c.amount, 14.88, 0.005), `commission = ${c.amount} (attendu 14,88)`);
  ok(close(c.amount * 24, 357.12, 0.005), `24 nouveaux clients → ${(c.amount * 24).toFixed(2)} de commissions (attendu 357,12)`);
  const v2 = evaluate({ ad_spend: 0, commissions: 357.12, new_customers: 24, first_orders_cm2: 64.17 * 24, first_orders_count: 24 });
  ok(close(v2.cac_global, 14.88, 0.005), `CAC = ${v2.cac_global?.toFixed(2)} (attendu 14,88)`);
  ok(close(v2.be_cac, 64.17), `BE-CAC = ${v2.be_cac?.toFixed(2)} (attendu 64,17)`);
  ok(close(64.17 / v2.cac_global, 4.31, 0.01), `LTV/CAC (une commande) = ${(64.17 / v2.cac_global).toFixed(2)} (attendu ≈ 4,31)`);
  // MER : toutes les ventes avec 15 % de commission → 1/0,15 ≈ 6,67 (CA HT au numérateur).
  const v3 = evaluate({ ca_brut: 100, remises: 0, rembours: 0, taxes: 0, ad_spend: 0, commissions: 15 });
  ok(close(v3.mer, 6.67, 0.01), `MER = ${v3.mer?.toFixed(2)} (attendu ≈ 6,67)`);
  // CA 100 ; produit 40 → CM1 60 ; port 5, emballage 2, paiement 3, retours 2 → CM2 48 (48 %) → BE-ROAS ≈ 2,08 ; pub 15 + commission 3 → CM3 30.
  const ex4 = { known_ca_ht: 100, known_ca_ttc: 100, ca_brut: 100, remises: 0, rembours: 0, taxes: 0, cogs: 40, shipping_cost: 5, packaging_cost: 2, payment_fees: 3, returns_cost: 2, ad_spend: 15, commissions: 3, known_orders: 1, orders: 1, target_margin_after_ads_pct: 20 };
  const v4 = evaluate(ex4);
  ok(v4.cm1 === 60 && v4.cm2 === 48 && v4.cm3 === 30, `CM1 ${v4.cm1} / CM2 ${v4.cm2} / CM3 ${v4.cm3} (attendu 60 / 48 / 30)`);
  ok(close(v4.cm2_pct, 48), `CM2 % = ${v4.cm2_pct} (attendu 48)`);
  ok(close(v4.be_roas, 2.08, 0.01), `BE-ROAS = ${v4.be_roas?.toFixed(3)} (attendu ≈ 2,08, CA sans taxe)`);
  // CM2 48 % et marge visée 20 % → ROAS cible = 1/0,28 ≈ 3,57.
  ok(close(v4.target_roas, 3.57, 0.01), `ROAS cible = ${v4.target_roas?.toFixed(3)} (attendu ≈ 3,57)`);
  // Panier 70, CM2 50 %, CAC 25 → 35 avant acquisition, 10 après.
  const v6 = evaluate({ ca_brut: 70, remises: 0, rembours: 0, taxes: 0, orders: 1, known_ca_ht: 70, cogs: 35, shipping_cost: 0, packaging_cost: 0, payment_fees: 0, returns_cost: 0, ad_spend: 25, commissions: 0, new_customers: 1 });
  ok(close(v6.contribution_per_new_customer_before_acq, 35) && close(v6.contribution_per_new_customer_after_acq, 10), `contribution nouveau client : ${v6.contribution_per_new_customer_before_acq} avant, ${v6.contribution_per_new_customer_after_acq} après (attendu 35 / 10)`);
  // CAC 40, contribution mensuelle 10 par client → récupéré en 4 mois.
  const t7 = thresholds({ cac_global: 40 }, { monthly_contribution_per_customer: 10 });
  ok(t7.cac_payback_months === 4, `récupération du CAC = ${t7.cac_payback_months} mois (attendu 4)`);
  // Stock 120, 4 ventes/jour → 30 jours ; délai 60 + tampon 15 → point de commande 300.
  const win = { start: "2026-08-01", end: "2026-08-31" }; // 31 jours → 124 unités = 4/jour
  const orders8 = [{ order_id: "s1", created_at: "2026-08-02T10:00:00Z", day_local: "2026-08-02", currency_code: "EUR", customer_id: "k", customer_order_index: 1, country_code: "FR", discount_codes: [], shipping_charged: 0, total_ttc: 1240 }];
  const lines8 = [{ order_id: "s1", line_item_id: "sl1", product_id: "P", variant_id: "V", quantity: 124, refunded_qty: 0, restocked_qty: null, revenue_units: 124, cogs_units: 124, unit_price_ttc: 10, unit_price_ht: 10, tax_per_unit: 0, unit_price_original_ht: null, cost_source: "confirmed", cm1_unit: 6, cout_rendu_unit: 4 }];
  const inv8 = [{ variant_id: "V", product_id: "P", available: 120, tracked: true, cost_per_unit: 4, day_local: "2026-08-31" }];
  const a8 = aggregate({ orders: orders8, lines: lines8, inventory: inv8, variantCosts: new Map([["V", { supplier_lead_days: 60, buffer_days: 15 }]]), settings: { shipping_cost_rules: { default: 0, confirmed: true }, packaging_cost_per_order: 0, gateway_fee_rules: [{ gateway: "*", pct: 0, fixed: 0, confirmed: true }] }, window: win, now: new Date("2026-09-22T00:00:00Z") });
  const s8 = a8.stock.byVariant.V;
  ok(close(s8.sales_per_day, 4) && close(s8.coverage_days, 30), `couverture = ${s8.coverage_days} jours (attendu 30) à ${s8.sales_per_day}/jour`);
  ok(close(s8.reorder_point, 300), `point de commande = ${s8.reorder_point} (attendu 300)`);
  ok(s8.reorder_now === true, "120 ≤ 300 → « recommander maintenant »");
}

// ── 2. Ligne de commande ──
console.log("\n── 2. Économie d'une ligne (HT, unités, coût rendu) ──");
{
  const inc = unitPrices({ unitPrice: 120, quantity: 2, taxLines: [{ amount: 40 }], taxesIncluded: true });
  ok(close(inc.unit_price_ht, 100) && close(inc.unit_price_ttc, 120) && close(inc.tax_per_unit, 20), "taxes incluses : 120 TTC, 40 de taxe pour 2 unités → 100 HT / unité");
  const exc = unitPrices({ unitPrice: 100, quantity: 2, taxLines: [{ amount: 40 }], taxesIncluded: false });
  ok(close(exc.unit_price_ht, 100) && close(exc.unit_price_ttc, 120), "taxes en sus : 100 HT + 20 → 120 TTC / unité (aucune hypothèse de taux)");
  const u1 = countedUnits({ quantity: 3, refunded_qty: 1, restocked_qty: 1 });
  ok(u1.revenue_units === 2 && u1.cogs_units === 2 && u1.restock_known, "remboursée ET restockée : 2 unités de CA, 2 de coût (A2c)");
  const u2 = countedUnits({ quantity: 3, refunded_qty: 1, restocked_qty: 0 });
  ok(u2.revenue_units === 2 && u2.cogs_units === 3, "remboursée NON restockée : 2 unités de CA, 3 de coût (le coût est perdu)");
  const u3 = countedUnits({ quantity: 3, refunded_qty: 1, restocked_qty: null });
  ok(u3.revenue_units === 2 && u3.cogs_units === 2 && !u3.restock_known, "restockType inconnu → repli quantité − remboursées (A2a)");
  const eu = landedCostUnit({ costRow: { prix_achat: 10, port_entrant: 5, qty_par_lot: 1, categorie: "Textile", shipping_model: "stock", vat_regime: "assujetti" }, shopCountryCode: "FR" });
  ok(eu.method === "eu_taric" && close(eu.components.droits, 1.8) && close(eu.coutRendu, 16.8), `UE (FR, Textile 12 %) : droits ${eu.components.droits}, coût rendu ${eu.coutRendu} (attendu 1,8 / 16,8 via engine.js)`);
  const fr = landedCostUnit({ costRow: { prix_achat: 10, port_entrant: 5, qty_par_lot: 1, categorie: "Textile", shipping_model: "stock", vat_regime: "franchise" }, shopCountryCode: "FR" });
  ok(close(fr.coutRendu, 20.16) && close(fr.components.tva_import_non_recup, 3.36), `franchise : TVA import non récupérable ${fr.components.tva_import_non_recup} → coût rendu ${fr.coutRendu} (attendu 3,36 / 20,16)`);
  const de = landedCostUnit({ costRow: { prix_achat: 10, port_entrant: 5, qty_par_lot: 1, categorie: "Textile", shipping_model: "stock", vat_regime: "franchise" }, shopCountryCode: "DE" });
  ok(close(de.vatRate, 0.19) && close(de.coutRendu, 10 + 5 + 1.8 + 16.8 * 0.19), `marchand DE : TVA import à 19 % (A8), coût rendu ${de.coutRendu.toFixed(3)}`);
  const us = landedCostUnit({ costRow: { prix_achat: 10, port_entrant: 5, qty_par_lot: 1, categorie: "Textile", duty_rate_pct: 10 }, shopCountryCode: "US" });
  ok(us.method === "generic_duty" && close(us.coutRendu, 16.5) && us.components.tva_import_non_recup === 0, `hors UE : (10 + 5) × 10 % = 1,5 de droits, coût rendu ${us.coutRendu}, pas de TVA d'import (A9)`);
  const ov = landedCostUnit({ costRow: { prix_achat: 10, port_entrant: 5, landed_cost_override: 12 }, shopCountryCode: "US" });
  ok(ov.method === "override" && ov.coutRendu === 12, "coût rendu saisi → prioritaire (décision 7)");
  ok(vatRateFor({ countryCode: "FR", categorie: "Livres" }) === 0.055 && vatRateFor({ countryCode: "DE" }) === 0.19 && vatRateFor({ countryCode: "US" }) === null, "vatRateFor : FR Livres 5,5 %, DE 19 %, US null");
  ok(isEuCountry("fr") && !isEuCountry("GB") && !isEuCountry(null), "isEuCountry : fr oui, GB non, null non");
  const gift = computeLineEconomics({ line: { line_item_id: "g", quantity: 1, unit_price: 50, tax_lines: [], is_gift_card: true }, order: { taxes_included: true }, costRow: { prix_achat: 1 }, settings: { shop_country_code: "FR" } });
  ok(gift.cost_source === "excluded" && gift.cm1_unit === null, "carte cadeau → exclue, CM1 null");
  const miss = computeLineEconomics({ line: { line_item_id: "m", quantity: 1, unit_price: 50, tax_lines: [{ amount: 10 }] }, order: { taxes_included: true }, costRow: null, settings: { shop_country_code: "FR" } });
  ok(miss.cost_source === "missing" && miss.cm1_unit === null && close(miss.unit_price_ht, 40), "coût manquant → 'missing', CM1 null (jamais 0), HT quand même calculé");
  const full = computeLineEconomics({ line: { line_item_id: "f", product_id: "P", quantity: 2, refunded_qty: 1, restocked_qty: 1, unit_price: 120, unit_price_original: 150, tax_lines: [{ amount: 40 }] }, order: { taxes_included: true }, costRow: { prix_achat: 10, port_entrant: 5, qty_par_lot: 1, categorie: "Textile", shipping_model: "stock", vat_regime: "assujetti", source: "confirmed", customs_confirmed: true }, settings: { shop_country_code: "FR" } });
  ok(close(full.unit_price_ht, 100) && close(full.cm1_unit, 83.2) && full.revenue_units === 1 && full.cogs_units === 1 && full.customs_estimated === false && close(full.unit_price_original_ht, 130), `ligne complète : HT 100, CM1/unité ${full.cm1_unit.toFixed(2)} (attendu 83,2), prix d'origine HT 130, classification confirmée`);
}

// ── 3. Agrégation ──
console.log("\n── 3. Agrégation (fixture août 2026) ──");
const settings = { shop_country_code: "FR", shop_timezone: "UTC", return_window_days: 30, packaging_cost_per_order: 2, shipping_cost_rules: { default: 5, byCountry: {}, confirmed: true }, gateway_fee_rules: [], target_margin_after_ads_pct: 20 };
const now = new Date("2026-09-22T12:00:00Z");
const window = { start: "2026-08-01", end: "2026-08-31" };
const orders = [
  { order_id: "o1", created_at: "2026-08-05T10:00:00Z", day_local: "2026-08-05", currency_code: "EUR", customer_id: "c1", customer_order_index: 1, utm_source: "facebook", visit_source: "facebook", country_code: "FR", discount_codes: ["INFLU10"], shipping_charged: 0, shipping_refunded: 0, total_ttc: 120, gateway_names: ["shopify_payments"] },
  { order_id: "o2", created_at: "2026-08-10T10:00:00Z", day_local: "2026-08-10", currency_code: "EUR", customer_id: "c2", customer_order_index: 1, utm_source: "google", visit_source: "google", country_code: "DE", discount_codes: [], shipping_charged: 0, shipping_refunded: 0, total_ttc: 120, gateway_names: ["paypal"] },
  { order_id: "o3", created_at: "2026-08-30T10:00:00Z", day_local: "2026-08-30", currency_code: "EUR", customer_id: "c1", customer_order_index: 2, source_name: "web", country_code: "FR", discount_codes: [], shipping_charged: 0, shipping_refunded: 0, total_ttc: 30, gateway_names: ["paypal"] },
  { order_id: "o4", created_at: "2026-08-12T10:00:00Z", day_local: "2026-08-12", currency_code: "EUR", excluded_reason: "test", discount_codes: [], shipping_charged: 0, total_ttc: 999 },
];
const mk = (order_id, line_item_id, product_id, variant_id, quantity, refunded_qty, restocked_qty, unit, tax, override) => computeLineEconomics({
  line: { line_item_id, product_id, variant_id, quantity, refunded_qty, restocked_qty, unit_price: unit, tax_lines: [{ amount: tax }] },
  order: { taxes_included: true }, costRow: override == null ? null : { landed_cost_override: override, source: "confirmed", customs_confirmed: true }, settings,
});
const lines = [
  { ...mk("o1", "L1", "P1", "V1", 1, 0, null, 120, 20, 40), order_id: "o1", currency_code: "EUR" },
  { ...mk("o2", "L2", "P2", "V2", 2, 1, 1, 60, 20, 30), order_id: "o2", currency_code: "EUR" },
  { ...mk("o3", "L3", "P3", "V3", 1, 0, null, 30, 5, null), order_id: "o3", currency_code: "EUR" },
  { ...mk("o4", "L4", "P1", "V1", 5, 0, null, 120, 20, 40), order_id: "o4", currency_code: "EUR" },
];
const fixture = {
  orders, lines, settings, window, now,
  fees: [{ order_id: "o1", fee_amount: 3, source: "shopify_payments", confirmed: true }],
  adSpend: [{ day_local: "2026-08-15", platform: "meta", spend_shop_currency: 20, platform_revenue: 150, platform_orders: 2 }, { day_local: "2026-08-16", platform: "google_ads", spend_shop_currency: 10, platform_revenue: 40, platform_orders: 1 }],
  codeRules: [{ code: "INFLU10", partner_id: "p1", commission_pct: 15, commission_base: "ht_after_discount" }],
  fixedCosts: [{ amount_monthly: 310 }],
  sessions: [{ day_local: "2026-08-05", source: "facebook", device: "mobile", sessions: 400, atc_sessions: 40, checkout_sessions: 20, purchase_sessions: 8 }, { day_local: "2026-08-10", source: "google", device: "desktop", sessions: 100, atc_sessions: 10, checkout_sessions: 5, purchase_sessions: 2 }],
  returns: [{ order_id: "o2", line_items: [{ line_item_id: "L2", quantity: 1, return_reason: "SIZE_TOO_LARGE" }] }],
  fulfillments: [{ order_id: "o1", created_at: "2026-08-05T14:00:00Z", delivered_at: "2026-08-08T10:00:00Z", promised_at: "2026-08-09T00:00:00Z" }, { order_id: "o2", created_at: "2026-08-10T12:00:00Z", delivered_at: "2026-08-14T10:00:00Z", promised_at: "2026-08-13T00:00:00Z" }],
  inventory: [{ variant_id: "V1", product_id: "P1", available: 120, tracked: true, cost_per_unit: 40, day_local: "2026-08-31" }, { variant_id: "V2", product_id: "P2", available: 5, tracked: true, cost_per_unit: 30, day_local: "2026-08-31" }, { variant_id: "V3", product_id: "P3", available: 10, tracked: false, day_local: "2026-08-31" }],
  variantCosts: new Map([["V1", { supplier_lead_days: 60, buffer_days: 15, prix_achat: 40 }]]),
  customers: [{ customer_id: "c1", cohort_month: "2026-08", first_order_at: "2026-08-05T10:00:00Z", second_order_at: "2026-08-30T10:00:00Z", orders_count: 2, cm2_total: 50 }, { customer_id: "c2", cohort_month: "2026-08", first_order_at: "2026-08-10T10:00:00Z", second_order_at: null, orders_count: 1, cm2_total: 13 }],
};
{
  const A = aggregate(fixture);
  const L = A.shop.leaves, N = A.shop.nodes;
  ok(L.orders === 3 && A.dataGaps.excluded_orders === 1, `3 commandes comptées, 1 exclue (test) — obtenu ${L.orders} / ${A.dataGaps.excluded_orders}`);
  ok(close(L.ca_brut, 270) && close(L.rembours, 60) && close(L.taxes, 35) && close(N.ca_ht, 175), `CA brut ${L.ca_brut}, rembours ${L.rembours}, taxes ${L.taxes} → CA HT ${N.ca_ht} (attendu 270 / 60 / 35 / 175)`);
  ok(close(L.known_ca_ht, 150) && close(L.unknown_ca_ht, 25) && L.unknown_cost_lines === 1 && L.known_orders === 2, "coût manquant : 25 de CA exclu des marges et compté (1 ligne, 2 commandes connues sur 3)");
  ok(close(L.cogs, 70) && close(N.cm1, 80), `COGS ${L.cogs} → CM1 ${N.cm1} (attendu 70 / 80, unité restockée non comptée)`);
  ok(close(L.shipping_cost, 10) && close(L.packaging_cost, 4) && close(L.payment_fees, 3), `port ${L.shipping_cost}, emballage ${L.packaging_cost}, frais ${L.payment_fees} (lignes connues seulement : 10 / 4 / 3)`);
  ok(close(N.cm2, 63) && close(N.cm2_pct, 42) && close(N.cm2_pct_ttc, 35), `CM2 ${N.cm2} (42 % HT, 35 % TTC)`);
  ok(close(L.commissions, 15) && close(L.ad_spend, 30) && close(N.cm3, 18), `commissions ${L.commissions}, pub ${L.ad_spend} → CM3 ${N.cm3} (attendu 15 / 30 / 18)`);
  ok(close(L.fixed_costs, 310) && close(N.net_result, -292), `coûts fixes ${L.fixed_costs} → résultat ${N.net_result} (attendu 310 / −292)`);
  ok(close(N.be_roas, 180 / 63) && close(N.target_roas, 1 / 0.15), `BE-ROAS ${N.be_roas?.toFixed(3)} (180/63), ROAS cible ${N.target_roas?.toFixed(3)} (1/(0,35−0,20))`);
  ok(close(N.mer, 175 / 45) && close(N.roas_utm, 6) && close(N.poas, 2.1) && close(N.cac_global, 22.5) && close(N.cac_paid, 15) && close(N.cac_partners, 15), `MER ${N.mer?.toFixed(3)}, ROAS UTM ${N.roas_utm}, POAS ${N.poas}, CAC global ${N.cac_global}, payant ${N.cac_paid}, partenaires ${N.cac_partners}`);
  ok(close(N.be_cac, 31.5) && L.first_orders_count === 2, `BE-CAC ${N.be_cac} sur ${L.first_orders_count} premières commandes (attendu 31,5)`);
  ok(close(N.aov, 175 / 3) && L.units === 3 && L.new_customers === 2, `panier moyen ${N.aov?.toFixed(2)}, 3 unités, 2 nouveaux clients`);
  ok(L.provisional_orders === 1 && close(A.shop.provisional_share, 100 * 25 / 175), `1 commande provisoire (30 j), part ${A.shop.provisional_share?.toFixed(2)} % du CA (A10)`);
  const sumProducts = Object.values(A.byProduct).reduce((s, p) => s + (p.nodes.ca_ht ?? 0), 0);
  const sumCm2 = Object.values(A.byProduct).reduce((s, p) => s + (p.nodes.cm2 ?? 0), 0);
  ok(close(sumProducts, N.ca_ht - L.shipping_charged_ht) && close(sumCm2, N.cm2), `Σ produits = boutique : CA HT ${sumProducts} / CM2 ${sumCm2}`);
  ok(A.byProduct.P3.nodes.cm2 === null && A.byProduct.P3.leaves.unknown_cost_lines === 1, "produit à coût manquant : CM2 null (jamais 0), compté");
  ok(A.byProduct.P1.nodes.cm2 === 50 && A.byProduct.P2.nodes.cm2 === 13, `CM2 produit : P1 ${A.byProduct.P1.nodes.cm2}, P2 ${A.byProduct.P2.nodes.cm2} (attendu 50 / 13)`);
  ok(A.byCode.INFLU10 && close(A.byCode.INFLU10.leaves.commissions, 15) && A.byCode.INFLU10.leaves.orders === 1 && A.byCode.INFLU10.leaves.new_customers === 1, "code INFLU10 : 1 commande, 1 nouveau client, 15 de commission");
  ok(A.byCountry.FR.leaves.orders === 2 && A.byCountry.DE.leaves.orders === 1, "par pays : FR 2, DE 1");
  ok(A.byChannel.facebook && A.byChannel.google && A.byChannel.web, "par canal : facebook, google, web");
  const meta = A.marketing.byPlatform.meta;
  ok(close(meta.nodes.poas, 2.5) && close(meta.nodes.roas_utm, 6) && close(meta.roas_platform, 7.5) && close(meta.roas_conservative, 6), `Meta : POAS ${meta.nodes.poas}, ROAS UTM ${meta.nodes.roas_utm}, plateforme ${meta.roas_platform}, prudent ${meta.roas_conservative}`);
  ok(A.currency === "EUR", "devise unique EUR (jamais MIXED)");
  ok(A.dataGaps.unconfirmed_fees === 2 && A.dataGaps.unknown_cost_lines === 1 && A.dataGaps.unconfirmed_shipping === 0, `trous : frais non confirmés ${A.dataGaps.unconfirmed_fees}, coûts manquants ${A.dataGaps.unknown_cost_lines}`);
  // Conversion
  const cv = A.conversion;
  const cvN = evaluate(cv);
  ok(cv.sessions === 500 && close(cvN.atc_rate, 10) && close(cvN.checkout_rate, 5) && close(cvN.cvr, 2) && close(cvN.completion_rate, 40), `entonnoir : ATC ${cvN.atc_rate} %, checkout ${cvN.checkout_rate} %, finalisation ${cvN.completion_rate} %, CVR ${cvN.cvr} %`);
  ok(cv.bySource.facebook.nodes.cvr === 2 && cv.byDevice.desktop.nodes.cvr === 2, "conversion par source et par appareil");
  // Retours
  ok(A.returns.orders_out_of_window === 2 && close(A.returns.return_rate, 50) && close(A.returns.refund_rate, 100 * 60 / 270) && A.returns.reasons.SIZE_TOO_LARGE === 1, `retours : ${A.returns.return_rate} % (2 commandes hors délai), remboursement ${A.returns.refund_rate?.toFixed(2)} %, motif taille`);
  // Expédition (5 août = mercredi, 10 août = lundi)
  ok(A.shipping.shipped === 2 && close(A.shipping.ship_delay_hours, 3) && A.shipping.delivered === 2 && close(A.shipping.otd, 50) && close(A.shipping.late_share, 50), `expédition : délai moyen ${A.shipping.ship_delay_hours} h ouvrées, OTD ${A.shipping.otd} %`);
  ok(close(businessHoursBetween("2026-08-07T16:00:00Z", "2026-08-10T10:00:00Z", "UTC"), 18), "heures ouvrées vendredi 16 h → lundi 10 h = 18 h (week-end exclu)");
  // Stock
  ok(A.stock.tracked && A.stock.byVariant.V3 === undefined && A.stock.overstock.includes("V1") && close(A.stock.byVariant.V1.cash_immobilized, 4800), "stock : V3 non suivi exclu, V1 en surstock (> 60 j), cash immobilisé 4 800");
  // Clients
  const co = A.customers.cohorts["2026-08"];
  ok(co.customers === 2 && co.repeat_rate[1] === 50 && co.repeat_rate[3] === null && co.frequency === 1.5 && close(co.ltv_cm2, 31.5), `cohorte 2026-08 : rachat M+1 ${co.repeat_rate[1]} %, M+3 null (cohorte trop jeune), fréquence ${co.frequency}, LTV CM2 ${co.ltv_cm2}`);
  ok(close(A.customers.ltv_cac, 31.5 / 22.5), `LTV/CAC = ${A.customers.ltv_cac?.toFixed(2)}`);
  // Fenêtre : rien hors août
  const B = aggregate({ ...fixture, window: { start: "2026-07-01", end: "2026-07-31" } });
  ok(B.shop.leaves.orders === 0 && B.shop.nodes.cm2 === null && B.shop.leaves.ad_spend === 0, "fenêtre juillet : 0 commande, CM2 null, 0 pub");
  ok(close(fixedCostsForWindow([{ amount_monthly: 310 }], { start: "2026-08-01", end: "2026-08-15" }), 150), "coûts fixes : 15 jours d'août sur 31 → 150");
  const C = aggregate({ ...fixture, settings: { ...settings, return_cost_per_return: 4 } });
  ok(close(C.shop.leaves.returns_cost, 4) && close(C.shop.nodes.cm2, 59) && close(C.byProduct.P2.nodes.cm2, 9), `frais de retour saisis (4 par retour) : returns_cost ${C.shop.leaves.returns_cost}, CM2 boutique ${C.shop.nodes.cm2}, P2 ${C.byProduct.P2.nodes.cm2} (attendu 4 / 59 / 9)`);
}

// ── 4. Allocation ──
console.log("\n── 4. Allocation des coûts de commande (A5, A4) ──");
{
  const m = allocateOrderCosts({ lines: [{ line_item_id: "a", line_ca_ht: 100 }, { line_item_id: "b", line_ca_ht: 50 }, { line_item_id: "c", line_ca_ht: null }], costs: { payment_fees: 3, shipping_cost: 6, packaging_cost: 3 } });
  ok(close(m.get("a").payment, 2) && close(m.get("a").shipping, 4) && close(m.get("a").packaging, 2), "ligne a (2/3 du CA) : 2 / 4 / 2");
  ok(close(m.get("b").payment, 1) && close(m.get("b").shipping, 2) && close(m.get("b").packaging, 1), "ligne b (1/3) : 1 / 2 / 1");
  ok(m.get("c").payment === 0 && m.get("c").share === 0, "ligne sans CA : rien alloué");
  const sum = ["a", "b", "c"].reduce((s, k) => s + m.get(k).payment + m.get(k).shipping + m.get(k).packaging, 0);
  ok(close(sum, 12), "Σ allocations = Σ coûts de la commande (12)");
  const z = allocateOrderCosts({ lines: [{ line_item_id: "a", line_ca_ht: 0 }], costs: { payment_fees: 3, shipping_cost: 6, packaging_cost: 3 } });
  ok(z.get("a").payment === 0 && z.get("a").shipping === 0, "Σ CA = 0 → 0 partout (pas de division)");
  const o = allocateOrderCosts({ lines: [{ line_item_id: "a", line_ca_ht: 100 }, { line_item_id: "b", line_ca_ht: 50, packaging_override_unit: 0.5, units: 2 }], costs: { payment_fees: 0, shipping_cost: 0, packaging_cost: 3 } });
  ok(close(o.get("b").packaging, 1) && close(o.get("a").packaging, 3), "surcharge emballage variante : b = 0,5 × 2, le pool (3) va entièrement à a");
}

// ── 5. Seuils ──
console.log("\n── 5. Seuils ──");
{
  const t = thresholds({ cm3_per_order: -5, cm2_per_order: 10, aov: 50 }, { fixed_costs_monthly: 1000, marketing_monthly: 200 });
  ok(t.breakeven.onCm3.status === "unreachable", "contribution CM3 ≤ 0 → seuil non atteignable (jamais un nombre négatif)");
  ok(t.breakeven.onCm2WithMarketing.status === "ok" && t.breakeven.onCm2WithMarketing.orders === 120 && t.breakeven.onCm2WithMarketing.revenue === 6000, "version B : (1000 + 200) / 10 = 120 commandes, 6 000 de CA");
  const u = thresholds({}, {});
  ok(u.cac_payback_months === null && u.breakeven.onCm3.status === "unknown", "données absentes → null / unknown, jamais 0");
  ok(evaluate({ cm2: 10, known_ca_ttc: 100, target_margin_after_ads_pct: 30 }).target_roas === null, "marge visée ≥ CM2 % → ROAS cible indéfini (null)");
}

// ── 6. minData ──
console.log("\n── 6. Données minimales (A11) ──");
{
  const g = gate("cvr", 2.4, { sessions: 120, orders: 12 });
  ok(g.status === "insufficient" && g.missing.sessions === 80 && g.missing.orders === undefined, `CVR à 120 sessions → insuffisant, « encore 80 sessions » (${JSON.stringify(g.missing)})`);
  ok(gate("cvr", 2.4, { sessions: 200, orders: 10 }).status === "ok", "seuil atteint → ok (borne inclusive)");
  ok(gate("cm2_pct", null, { known_orders: 50 }, ["unknown_cost_lines"]).status === "unknown", "valeur null malgré les données → 'unknown' avec ses trous");
  ok(minDataFor("ca_ht", {}) === null, "nœud sans seuil → jamais bloqué");
  const custom = { cvr: { sessions: 10 } };
  ok(gate("cvr", 1, { sessions: 12 }, [], custom).status === "ok", "table de seuils injectable (modifiable sans toucher au moteur)");
  ok(Object.keys(MIN_DATA).length >= 25, `table MIN_DATA unique (${Object.keys(MIN_DATA).length} nœuds)`);
}

// ── 7. Graphe et simulateur ──
console.log("\n── 7. Graphe (acyclique) et simulateur (déterministe) ──");
{
  const order = topologicalOrder();
  ok(order.length === NODES.length, `ordre topologique complet (${order.length} nœuds)`);
  ok(NODES.every((n) => n.inputs.every((i) => LEAF_INPUTS.includes(i) || NODES.some((m) => m.id === i))), "chaque entrée de nœud est une feuille ou un nœud déclaré");
  let threw = false; try { topologicalOrder([{ id: "x", inputs: ["y"], compute: () => 1 }, { id: "y", inputs: ["x"], compute: () => 1 }], []); } catch { threw = true; }
  ok(threw, "un cycle lève une erreur explicite");
  const base = { known_ca_ht: 100, known_ca_ttc: 100, ca_brut: 100, remises: 0, rembours: 0, taxes: 0, cogs: 40, shipping_cost: 5, packaging_cost: 2, payment_fees: 3, returns_cost: 2, ad_spend: 15, commissions: 3, fixed_costs: 45, known_orders: 1, orders: 1, new_customers: 1, attributed_new_customers: 1 };
  const s1 = simulate({ inputs: base, levers: { price_factor: 1.1 } });
  const s2 = simulate({ inputs: base, levers: { price_factor: 1.1 } });
  ok(JSON.stringify(s1.after) === JSON.stringify(s2.after), "déterministe : mêmes entrées → mêmes sorties");
  ok(close(s1.after.known_ca_ttc, 110) && s1.after.cogs === 40 && s1.after.orders === 1 && close(s1.delta.cm2, 10 - 0.3), "prix +10 % : CA +10, coût produit et commandes inchangés (volume constant), frais de paiement suivent");
  ok(s1.assumptions.some((a) => a.key === "volume_constant_price") && s1.note === "scenario_not_forecast", "hypothèses listées + mention « scénario, pas prévision »");
  const s3 = simulate({ inputs: base, levers: { cac: 20 } });
  ok(s3.after.ad_spend === 20 && s3.assumptions.some((a) => a.key === "ad_spend_from_cac"), "levier CAC → dépense pub = CAC × nouveaux clients");
  const s4 = simulate({ inputs: base, overrides: { cm2: 999 } });
  ok(s4.after.cm2 === 999 && s4.after.cm3 === 999 - 18, "override brut d'un nœud → ses descendants suivent");
  const f = findThreshold({ inputs: base, lever: "cvr_factor", node: "net_result", target: 0, lo: 0.1, hi: 5 });
  ok(f != null && close(f, 4 / 3, 1e-3), `recherche de seuil : conversion × ${f?.toFixed(4)} pour un résultat nul (attendu 1,3333 — pub constante)`);
  ok(findThreshold({ inputs: base, lever: "price_factor", node: "cm2", target: 10_000, lo: 0.5, hi: 2 }) === null, "cible hors intervalle → null (pas de faux seuil)");
}

// ── 8. engine.js : périmètre d'import ──
console.log("\n── 8. engine.js intouché : périmètre d'import du moteur ──");
{
  const dir = new URL("../app/lib/econ/", import.meta.url);
  const srcs = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(new URL(f, dir), "utf8"));
  const engineImports = srcs.flatMap((s) => [...s.matchAll(/import \{([^}]+)\} from "\.\.\/engine\.js"/g)].map((m) => m[1]));
  ok(engineImports.length === 1 && /computeLandedCost/.test(engineImports[0]) && /CUSTOMS_RATES/.test(engineImports[0]) && !/computeMargin|calcNetMargin|VAT_RATES/.test(engineImports[0]), `un seul import d'engine.js : ${engineImports[0]?.trim()}`);
  ok(srcs.every((s) => !/from "\.\.\/supabase|from "react|process\.env/.test(s)), "econ/ : aucun I/O, aucun React, aucune lecture d'env (module pur)");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 24 (moteur économique) : ✓ Tous les tests passent"
  : ` BILAN LOT 24 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
