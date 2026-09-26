// ════════════════════════════════════════════════════════════════════════════════
//  LOT 34 — D1c, section Produits (X6a) + audit catalogue Expert + cron sur shop_settings (X7).
//  Statut de coût par produit, liste (CA HT, CM2, CM2 %, unités), tri/filtre, audit (coût marchand
//  prioritaire, coût Shopify « à confirmer », réglages manquants comptés 0 et signalés, seuil du
//  marchand), branchements (navigation, route, plafond partagé, cron).
//  Pour lancer : node tests/lot34_products.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { costSourcesByProduct, costStatus, productListEntry, productSummary, sortProducts, filterByStatus, returnRateFromKpis, auditInputs, auditAssumptions, classifyAuditRows, PRODUCT_COST_STATUSES } from "../app/lib/products.js";
import { unitEconomics, unitDefaultsFromSettings } from "../app/lib/simulator/newProduct.js";
import { runCatalogAudit } from "../app/lib/audit.server.js";
import { sectionById } from "../app/lib/sections.js";
import { CATALOGS } from "../app/locales/index.js";
import { makeShop } from "./fixtures/i0_shops.mjs";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 0.01) => a != null && b != null && Math.abs(a - b) <= eps;
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const NOW = new Date("2026-09-25T00:00:00Z");

console.log("\n── 1. Statut de coût par produit ──");
{
  const rows = [
    { product_id: "A", cost_source: "confirmed" }, { product_id: "A", cost_source: "imported" },
    { product_id: "B", cost_source: "confirmed" }, { product_id: "B", cost_source: "estimated" },
    { product_id: "C", cost_source: "confirmed" }, { product_id: "C", cost_source: "missing" },
    { product_id: "D", cost_source: "missing" },
    { product_id: "E", cost_source: "excluded" }, { product_id: "F", cost_source: "confirmed", is_gift_card: true }, { product_id: null, cost_source: "confirmed" },
  ];
  const m = costSourcesByProduct(rows);
  ok(["A", "B", "C", "D"].map((id) => costStatus(m.get(id))).join(",") === "set,to_confirm,partial,missing", "saisi/importé → renseigné ; Shopify/estimé → à confirmer ; une ligne sans coût → en partie ; aucune → sans coût");
  ok(!m.has("E") && !m.has("F") && m.size === 4, "cartes cadeaux, lignes exclues et produits sans id ignorés");
  ok(costStatus(null, { known_ca_ht: 0, unknown_ca_ht: 50 }) === "missing" && costStatus(null, { known_ca_ht: 10, unknown_ca_ht: 5 }) === "partial" && costStatus(null, { known_ca_ht: 10, unknown_ca_ht: 0 }) === "to_confirm", "sans compteur de lignes : repli prudent sur l'agrégat (jamais « renseigné » sans preuve)");
}

console.log("\n── 2. Liste, synthèse, tri, filtre ──");
{
  const shop = makeShop("healthy").current.agg;
  const [id, e] = Object.entries(shop.byProduct).find(([k]) => k !== "__unknown__");
  const p = productListEntry({ id, title: "Tee", entry: e, sources: { merchant: 3, other: 0, missing: 0 } });
  ok(close(p.ca_ht, e.nodes.ca_ht) && close(p.cm2, e.nodes.cm2) && close(p.cm2_pct, e.nodes.cm2_pct) && p.units === e.nodes.units && p.orders === e.leaves.orders && p.status === "set", `entrée = nœuds de l'agrégat (CA ${p.ca_ht}, CM2 ${p.cm2.toFixed(2)}, ${p.cm2_pct.toFixed(1)} %, ${p.units} unités)`);
  const none = productListEntry({ id: "X", title: "X", entry: { nodes: { ca_ht: 100, known_ca_ht: 0, cm2: 0, cm2_pct: 0, units: 2 }, leaves: { orders: 2, unknown_ca_ht: 100 } } });
  ok(none.cm2 === null && none.cm2_pct === null && none.status === "missing", "aucun coût connu → CM2 et CM2 % absents (jamais 0), statut « sans coût »");
  const list = [{ id: 1, ca_ht: 100, cm2: 30, cm2_pct: 30, units: 5, unknown_ca_ht: 0, status: "set" }, { id: 2, ca_ht: 300, cm2: null, cm2_pct: null, units: 9, unknown_ca_ht: 300, status: "missing" }, { id: 3, ca_ht: 200, cm2: -10, cm2_pct: -5, units: 1, unknown_ca_ht: 50, status: "partial" }];
  const s = productSummary(list);
  ok(s.total === 3 && s.counts.set === 1 && s.counts.missing === 1 && s.counts.partial === 1 && close(s.unknown_share, (350 / 600) * 100), "synthèse : compteurs par statut, part du CA sans coût");
  ok(sortProducts(list, "ca_ht").map((x) => x.id).join() === "2,3,1" && sortProducts(list, "cm2").map((x) => x.id).join() === "1,3,2" && sortProducts(list, "bogus").map((x) => x.id).join() === "2,3,1", "tri : CA par défaut ; CM2 absente en fin de liste ; tri inconnu → CA");
  ok(filterByStatus(list, "partial").length === 1 && filterByStatus(list, "nope").length === 3 && PRODUCT_COST_STATUSES.length === 4, "filtre par statut ; statut inconnu → tous");
  const ok1 = returnRateFromKpis([{ id: "return_rate", status: "ok", value: 3.456 }]), ko1 = returnRateFromKpis([{ id: "return_rate", status: "insufficient", value: null, missing: { orders_out_of_window: 33 } }]);
  ok(ok1.returnRatePct === 3.5 && ok1.returnRateMissing === null && ko1.returnRatePct === null && ko1.returnRateMissing === 33 && returnRateFromKpis([]).returnRatePct === null, "taux de retour de l'audit = indicateur « Taux de retour » de l'app (3,5 %) ; non mesurable → vide, commandes manquantes (33)");
}

console.log("\n── 3. Audit : entrées, calcul, classement ──");
{
  const settings = { vat_regime: "assujetti", shipping_model: "stock", packaging_cost_per_order: 0.5, shipping_cost_rules: { default: 4, confirmed: true }, gateway_fee_rules: [{ gateway: "*", pct: 1.5, fixed: 0.25, confirmed: true }], return_cost_per_return: 3, shop_country_code: "FR" };
  const d = unitDefaultsFromSettings(settings);
  ok(d.packaging === "0.5" && d.shipping === "4" && d.payment_pct === "1.5" && d.payment_fixed === "0.25" && d.return_cost === "3", "valeurs de départ = réglages confirmés");
  ok(unitDefaultsFromSettings({ shipping_cost_rules: { default: 4, confirmed: false }, gateway_fee_rules: [{ pct: 2, confirmed: false }] }).shipping === undefined && unitDefaultsFromSettings({ gateway_fee_rules: [{ pct: 2 }] }).payment_pct === undefined, "port ou frais non confirmés → jamais repris");
  const vc = { source: "confirmed", prix_achat: 22, port_entrant: 40, qty_par_lot: 10, categorie: "Textile" };
  const a = auditInputs({ price: "60", shopifyCost: "30", vc, category: "Textile", settings, returnRatePct: 5 });
  ok(a.cost_source === "merchant" && a.inputs.prix_achat === "22" && a.inputs.port_entrant === "40" && a.inputs.qty_par_lot === "10", "coût marchand prioritaire sur le coût Shopify (22 € et non 30 €), port et lot repris");
  const r = unitEconomics({ inputs: a.inputs, shopCountryCode: "FR", now: NOW });
  ok(r.ok && close(r.cm2, 12.58) && close(r.cm2_pct, 25.16, 0.05), `même calcul que le Simulateur S3 : CM2 ${r.cm2} (${r.cm2_pct.toFixed(1)} %)`);
  const sh = auditInputs({ price: "60", shopifyCost: "30", vc: { source: "estimated", prix_achat: 22 }, category: "Textile", settings });
  ok(sh.cost_source === "shopify" && sh.inputs.prix_achat === "30" && sh.inputs.port_entrant === "0", "coût non saisi par le marchand → coût Shopify, marqué à confirmer");
  ok(auditInputs({ price: "60", shopifyCost: null, category: "Autre", settings }) === null && auditInputs({ price: "0", shopifyCost: "5", settings }) === null, "sans coût ou sans prix → non évalué (jamais un coût 0)");
  const ht = unitEconomics({ inputs: { ...a.inputs, price_ttc: "50", prices_include_tax: false }, shopCountryCode: "FR", now: NOW });
  ok(close(ht.price_ht, 50) && close(ht.price_ttc, 60) && close(ht.cm2, r.cm2), "prix catalogue HT (boutique hors taxes) : même marge que 60 € TTC");
  ok(auditAssumptions({}).join() === "packaging,shipping,payment_pct,return_cost" && auditAssumptions(settings).length === 0, "réglages manquants listés (comptés 0 et affichés)");
  const g = classifyAuditRows([{ id: 1, cm2_pct: 30 }, { id: 2, cm2_pct: -4 }, { id: 3, cm2_pct: 10 }, { id: 4, cm2_pct: 50 }], 25);
  ok(g.loser.map((x) => x.id).join() === "2" && g.risky.map((x) => x.id).join() === "3" && g.winner.map((x) => x.id).join() === "1,4", "classement par le seuil du marchand (25 %) : à perte / sous l'objectif / à l'objectif, pire en premier");
  ok(classifyAuditRows([{ id: 1, cm2_pct: 10 }], 0).winner.length === 1, "seuil 0 : bande « sous l'objectif » vide (même frontière que l'alerte e-mail)");
}

console.log("\n── 4. Audit de bout en bout (Admin et Supabase simulés) ──");
{
  const node = (id, title, price, cost, variant) => ({ id, title, productType: "T-shirt", category: { name: "Apparel" }, variants: { edges: [{ node: { id: variant, price, inventoryItem: { unitCost: cost == null ? null : { amount: cost } } } }] } });
  const admin = { graphql: async () => ({ json: async () => ({ data: { shop: { taxesIncluded: true }, products: { edges: [{ node: node("gid://shopify/Product/1", "Tee", "60.00", "30.00", "gid://shopify/ProductVariant/11") }, { node: node("gid://shopify/Product/2", "Cap", "20.00", "25.00", "gid://shopify/ProductVariant/21") }, { node: node("gid://shopify/Product/3", "Mug", "15.00", null, "gid://shopify/ProductVariant/31") }], pageInfo: { hasNextPage: false, endCursor: null } } } }) }) };
  const tables = {
    shop_settings: { vat_regime: "assujetti", shipping_model: "stock", packaging_cost_per_order: 0.5, profitability_threshold_pct: 25, shop_country_code: "FR" },
    variant_costs: [{ variant_id: "gid://shopify/ProductVariant/11", source: "confirmed", prix_achat: 22, port_entrant: 40, qty_par_lot: 10, categorie: "Textile", customs_confirmed: true }],
  };
  const writes = [];
  const supabase = { from: (t) => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tables[t] }), then: (res) => res({ data: tables[t] }), upsert: () => { writes.push(t); return q; }, insert: () => { writes.push(t); return q; }, update: () => { writes.push(t); return q; } }; return q; } };
  const out = await runCatalogAudit({ admin, supabase, shop: "x.myshopify.com", returnRatePct: 5, now: NOW });
  ok(out.scanned === 3 && out.rows.length === 2 && out.noCost === 1 && !out.incomplete && out.thresholdPct === 25, "3 produits analysés : 2 évalués, 1 sans coût, seuil 25 % de shop_settings");
  const tee = out.rows.find((x) => x.title === "Tee"), cap = out.rows.find((x) => x.title === "Cap");
  ok(tee.cost_source === "merchant" && tee.cost === 22 && tee.category === "Textile" && tee.customs_estimated === false, "Tee : coût confirmé 22 €, catégorie douanière confirmée");
  ok(cap.cost_source === "shopify" && cap.cm2 < 0 && cap.customs_estimated === true, "Cap : coût Shopify à confirmer, marge négative, catégorie estimée");
  ok(out.missingSettings.join() === "shipping,payment_pct,return_cost" && writes.length === 0, "réglages manquants signalés ; aucune écriture en base (lecture seule)");
}

console.log("\n── 5. Branchements ──");
{
  ok(sectionById("products")?.status === "live" && sectionById("products")?.path === "/app/products", "Produits : section live dans la navigation (Explorer)");
  const route = read("app/routes/app.products.jsx");
  ok(/ent\?\.isExpert !== true\) return \{ intent: "audit", ok: false, error: "expert_only" \}/.test(route) && /checkRateLimit\(session\.shop, "run_audit", AUDIT_DAILY_LIMIT\)/.test(route) && /AUDIT_DAILY_LIMIT = 10/.test(route), "audit : Expert vérifié côté serveur, plafond 10 par jour sur la clé run_audit de l'écran classique");
  ok(/shouldRevalidate/.test(route) && /productLimit: PRODUCTS_MAX/.test(route), "pas de rechargement après l'audit ; liste plafonnée à 200 produits");
  const cron = read("app/routes/api.cron.profitability.jsx");
  ok(/from\("shop_settings"\)\s*\.select\("profitability_threshold_pct"\)/.test(cron) && !/from\("shop_plans"\)/.test(cron), "cron de rentabilité : seuil lu dans shop_settings, plus aucune lecture de shop_plans");
  const srv = read("app/lib/overview.server.js");
  ok(/newProductDefaults: unitDefaultsFromSettings\(settings\)/.test(srv) && /costSourcesByProduct\(lineSlice\.filter/.test(srv) && /keptIds\.has\(l\.order_id\)/.test(srv), "loadOverview : statut de coût sur les lignes des commandes retenues de la période ; défauts partagés avec S3");
  const keys = Object.keys(CATALOGS.en).filter((k) => k.startsWith("products."));
  ok(keys.length > 50 && keys.every((k) => CATALOGS.fr[k]) && PRODUCT_COST_STATUSES.every((s) => CATALOGS.fr[`products.status.${s}`]), `${keys.length} clés products.* en/fr`);
  ok(read("package.json").includes("lot34_products"), "lot 34 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 34 (section Produits + audit D1c) : ✓ Tous les tests passent" : ` BILAN LOT 34 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
