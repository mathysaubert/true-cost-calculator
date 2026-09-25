// ════════════════════════════════════════════════════════════════════════════════
//  LOT 33 — S3, Simulateur en mode Produit (X5a) : nouveau produit (coût rendu du moteur, TVA de
//  vente, marge unitaire, prix minimum par bissection, sans « + 4,5 % »), produit existant
//  (Simulateur sur les feuilles d'un produit réel), branchements et scans.
//  Pour lancer : node tests/lot33_simulator_product.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { unitEconomics, minPriceFor, NEW_PRODUCT_FIELDS } from "../app/lib/simulator/newProduct.js";
import { landedCostUnit } from "../app/lib/econ/line.js";
import { runScenario } from "../app/lib/simulator/index.js";
import { CATALOGS } from "../app/locales/index.js";
import { makeShop } from "./fixtures/i0_shops.mjs";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const close = (a, b, eps = 0.01) => a != null && b != null && Math.abs(a - b) <= eps;
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const NOW = new Date("2026-09-25T00:00:00Z");
const base = { price_ttc: "60", prix_achat: "22", port_entrant: "40", qty_par_lot: "10", packaging: "0,5", shipping: "4", payment_pct: "1.5", payment_fixed: "0.25", return_rate_pct: "5", return_cost: "3", vat_regime: "assujetti", shipping_model: "stock", categorie: "Textile" };

console.log("\n── 1. Nouveau produit : marge unitaire ──");
{
  const r = unitEconomics({ inputs: base, shopCountryCode: "FR", now: NOW });
  const landed = landedCostUnit({ costRow: { prix_achat: 22, port_entrant: 40, qty_par_lot: 10, vat_regime: "assujetti", shipping_model: "stock", categorie: "Textile" }, shopCountryCode: "FR", now: NOW });
  ok(r.ok && close(r.price_ht, 50) && r.sale_vat_rate === 0.2, `prix HT = 60 / 1,2 = ${r.price_ht} (TVA de vente FR 20 %)`);
  ok(close(r.landed, landed.coutRendu) && r.method === "eu_taric", `coût rendu = econ/line.js (moteur), méthode douane UE : ${r.landed}`);
  const fees = 60 * 0.015 + 0.25, returns = 0.05 * (50 + 3);
  ok(close(r.payment_fees, fees) && close(r.returns, returns), `frais ${r.payment_fees} (1,5 % du TTC + 0,25), retours ${r.returns} (5 % × (prix HT + coût par retour))`);
  ok(close(r.cm1, 50 - landed.coutRendu) && close(r.cm2, r.cm1 - 0.5 - 4 - fees - returns) && close(r.cm2_pct, (r.cm2 / r.price_ht) * 100, 0.05), `CM1 ${r.cm1}, CM2 ${r.cm2} (${r.cm2_pct.toFixed(1)} %)`);
  const fr = unitEconomics({ inputs: { ...base, vat_regime: "franchise" }, shopCountryCode: "FR", now: NOW });
  ok(fr.price_ht === 60 && fr.sale_vat_rate === 0, "franchise de TVA : prix HT = prix TTC");
  const us = unitEconomics({ inputs: { ...base, duty_rate_pct: "10" }, shopCountryCode: "US", now: NOW });
  ok(us.method === "generic_duty" && us.sale_vat_rate === 0 && close(us.landed, (22 + 4) * 1.1), `hors UE : droits génériques (22 + 40 / 10) × 1,1 = ${us.landed}, pas de TVA de vente dans le modèle`);
  const drop = unitEconomics({ inputs: { ...base, shipping_model: "dropshipping" }, shopCountryCode: "FR", now: NOW });
  ok(drop.components.port_entrant === 40, "dropshipping : port fournisseur par unité (non divisé par le lot)");
  const miss = unitEconomics({ inputs: { prix_achat: "22" }, shopCountryCode: "FR" });
  ok(!miss.ok && miss.missing.join(",") === "price_ttc", "prix de vente manquant → signalé, aucun calcul");
  ok(unitEconomics({ inputs: { price_ttc: "60", prix_achat: "0" } }).missing.includes("prix_achat"), "prix d'achat nul → manquant (jamais de coût fictif)");
}

console.log("\n── 2. Prix minimum pour une CM2 % cible ──");
{
  const m = minPriceFor({ inputs: base, shopCountryCode: "FR", targetPct: 40, now: NOW });
  ok(m.reached && m.result.cm2_pct >= 40 && unitEconomics({ inputs: { ...base, price_ttc: String(m.price - 0.02) }, shopCountryCode: "FR", now: NOW }).cm2_pct < 40, `prix minimum pour 40 % : ${m.price} (au centime : 2 centimes de moins passent sous 40 %)`);
  ok(minPriceFor({ inputs: { ...base, return_rate_pct: "90" }, shopCountryCode: "FR", targetPct: 40 }).reason === "out_of_range", "objectif impossible (retours 90 %) → hors de portée");
  ok(minPriceFor({ inputs: base, targetPct: 100 }).reason === "invalid" && minPriceFor({ inputs: { price_ttc: "10" }, targetPct: 30 }).reason === "missing", "cible ≥ 100 % invalide ; prix d'achat manquant signalé");
  const src = read("app/lib/simulator/newProduct.js");
  ok(!/1\.1\b|4[,.]5|\* 1\.10/.test(src.replace(/\/\/.*$/gm, "")) && !/calculations/.test(src.replace(/\/\/.*$/gm, "")), "aucun « + 4,5 % » ni facteur 1,10 codé en dur, aucune table calculations");
  ok(/landedCostUnit\(/.test(src) && /vatRateFor\(/.test(src) && !/engine\.js/.test(src), "coût rendu et TVA par le moteur econ (engine.js via line.js, jamais importé directement)");
}

console.log("\n── 3. Produit existant ──");
{
  const shop = makeShop("healthy").current.agg;
  const [pid, entry] = Object.entries(shop.byProduct).filter(([id]) => id !== "__unknown__").sort((a, b) => b[1].nodes.ca_ht - a[1].nodes.ca_ht)[0];
  const r = runScenario({ leaves: entry.leaves, values: { price: 5 }, periodDays: 30 });
  ok(pid && !r.empty && Math.abs(r.nodes.find((n) => n.id === "ca_ht").after - entry.nodes.ca_ht * 1.05) < 0.01, `Simulateur sur les feuilles d'un produit (${pid}) : prix +5 % → CA × 1,05`);
  ok(r.nodes.find((n) => n.id === "cm2").before != null && Math.abs(r.nodes.find((n) => n.id === "cm2").before - entry.nodes.cm2) < 0.01, "avant = CM2 réelle du produit");
  const srv = read("app/lib/overview.server.js");
  ok(/withProducts = false/.test(srv) && /PRODUCT_LIST_MAX = 50/.test(srv) && /productLeaves = Object\.fromEntries/.test(srv) && /id !== "__unknown__"/.test(srv), "loadOverview : feuilles par produit seulement sur demande, 50 produits au plus fort CA, sans le produit inconnu");
  const route = read("app/routes/app.simulator.jsx");
  ok(/intent === "keep_new"/.test(route) && /unitEconomics\(\{ inputs/.test(route) && /mode: "new"/.test(route) && /mode, product_id: productId/.test(route) && /withProducts: mode === "product"/.test(route), "action : nouveau produit recalculé côté serveur, scénarios produit avec mode et produit, feuilles produit rechargées");
  const dec = read("app/lib/decisions.server.js");
  ok(/observeProduct: productId/.test(dec) && /view\.productObs\?\.after/.test(dec) && /productObs: observeProduct \?/.test(srv), "observé à J+30 d'une décision produit : nœuds du produit seul dans les deux fenêtres, jamais la boutique entière");
  ok(/filter\(\(m\) => m\.mode !== "new"\)/.test(route) && /product_title: mode === "product"/.test(route), "comparaison sans les nouveaux produits ; titre du produit gardé dans le scénario");
}
{
  const { scenarioSearch } = await import("../app/lib/simulator/scenario.js");
  ok(scenarioSearch({ values: { price: 5 }, days: 30, mode: "product", product: "gid://shopify/Product/1" }) === "?days=30&mode=product&product=gid%3A%2F%2Fshopify%2FProduct%2F1&price=5" && scenarioSearch({ values: { price: 5 }, days: 30, mode: "shop" }) === "?days=30&price=5", "Rejouer : mode et produit gardés pour un scénario produit, inchangé pour la boutique");
}

console.log("\n── 4. Catalogues et scans ──");
{
  ok(NEW_PRODUCT_FIELDS.every((f) => CATALOGS.en[`sim.new.field.${f.id}`] && CATALOGS.fr[`sim.new.field.${f.id}`]) && ["price_ht", "landed", "cm1", "packaging", "shipping", "payment_fees", "returns", "cm2"].every((k) => CATALOGS.fr[`sim.new.line.${k}`]) && ["shop", "product", "new"].every((m) => CATALOGS.en[`sim.mode.${m}`]), "champs, lignes et modes traduits en/fr");
  const ui = read("app/components/simulator/NewProduct.jsx") + read("app/components/simulator/ModeBar.jsx");
  ok(!/<s-text-field|<s-select/.test(ui) && /<input type="number"/.test(ui) && /method="get"/.test(ui), "champs natifs tenus par React (C1a), sélection de produit en GET");
  ok(read("package.json").includes("lot33_simulator_product"), "lot 33 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 33 (Simulateur mode Produit S3) : ✓ Tous les tests passent" : ` BILAN LOT 33 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
