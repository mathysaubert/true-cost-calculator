// ════════════════════════════════════════════════════════════════════════════════
//  LOT 32 — F4-D1b Offre + F4-D1a Coûts produits : facturation déplacée À L'IDENTIQUE (comparée à
//  l'écran classique), offres = configuration de shopify.server.js, portage des coûts (groupement,
//  formulaires, suggestions serveur, erreurs traduites), intégrité (aucune écriture à l'ouverture).
//  Pour lancer : node tests/lot32_plan_costs.mjs
// ════════════════════════════════════════════════════════════════════════════════
import { readFileSync } from "node:fs";
import { PLAN_OFFERS, planView, PLAN_CURRENCY } from "../app/lib/plans.js";
import { groupProducts, statusCounts, filterProducts, parseProductForm, COST_FIELDS, NUMBER_FIELDS } from "../app/lib/productCosts.js";
import { PAYS_KEYS, CATEGORIE_KEYS } from "../app/lib/variantCosts.js";
import { CATALOGS } from "../app/locales/index.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };
const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const norm = (s) => s.replace(/\s+/g, " ").trim();

console.log("\n── 1. Facturation déplacée à l'identique (X4) ──");
{
  const legacy = read("app/routes/app._index.jsx"), moved = read("app/lib/billing.server.js");
  const block = (src, plan) => { const i = src.indexOf(`plan: ${plan},`); return norm(src.slice(src.lastIndexOf("await billing.request({", i), src.indexOf("});", i) + 3)); };
  ok(block(legacy, "PLAN_PRO") === block(moved, "PLAN_PRO"), "billing.request Pro : arguments identiques (plan, isTest, returnUrl)");
  ok(block(legacy, "PLAN_EXPERT") === block(moved, "PLAN_EXPERT"), "billing.request Expert : arguments identiques (y compris l'essai bêta)");
  const devFn = (src) => norm(src.slice(src.indexOf("async function isDevStore(admin)"), src.indexOf("return false; // au moindre doute") + 40));
  ok(devFn(legacy) === devFn(moved), "isDevStore : corps identique (défaut sûr : doute → facturation réelle)");
  const q = (src) => norm(src.slice(src.indexOf("query AllSubscriptions"), src.indexOf("`;", src.indexOf("query AllSubscriptions"))));
  ok(q(legacy) === q(moved), "requête des abonnements identique (allSubscriptions, pas activeSubscriptions)");
  ok(/resolveEntitlement\(\{ shop, json: subJson, refetch/.test(moved), "droit au plan : même résolveur (fail-safe D1, FROZEN D2, indéterminé Q1)");
  const route = read("app/routes/app.settings.plan.jsx");
  ok(/intent === "subscribe_pro"\) return requestSubscription/.test(route) && /intent === "subscribe_expert"\) return requestSubscription/.test(route) && !/billing\.request/.test(route), "la route n'appelle la facturation que via le module déplacé");
}

console.log("\n── 2. Offres = configuration de facturation ──");
{
  const cfg = read("app/shopify.server.js");
  const amount = (plan) => Number(cfg.slice(cfg.indexOf(`[${plan}]:`)).match(/amount:\s*(\d+)/)[1]);
  const trial = (plan) => Number(cfg.slice(cfg.indexOf(`[${plan}]:`)).match(/trialDays:\s*(\d+)/)[1]);
  const by = Object.fromEntries(PLAN_OFFERS.map((o) => [o.id, o]));
  ok(by.pro.price === amount("PLAN_PRO") && by.expert.price === amount("PLAN_EXPERT") && by.free.price === 0, `prix affichés = configuration (${by.pro.price} / ${by.expert.price})`);
  ok(by.pro.trialDays === trial("PLAN_PRO") && by.expert.trialDays === trial("PLAN_EXPERT"), "essais affichés = configuration");
  ok(/currencyCode:\s*"USD"|USD/.test(cfg) && PLAN_CURRENCY === "USD", "devise de facturation USD");
  const free = planView({ ent: { isPro: false, isExpert: false, source: "live" } });
  ok(free.current === "free" && free.offers.filter((o) => o.canSubscribe).map((o) => o.id).join(",") === "pro,expert", "gratuit : montées vers Pro et Expert");
  const pro = planView({ ent: { isPro: true, isExpert: false, source: "live" }, isBeta: true, betaTrialDays: 45 });
  ok(pro.current === "pro" && pro.offers.filter((o) => o.canSubscribe).map((o) => o.id).join(",") === "expert" && pro.offers.find((o) => o.id === "expert").trialDays === 45, "Pro bêta : seule montée Expert, essai 45 jours");
  const ex = planView({ ent: { isPro: true, isExpert: true, source: "cache" } });
  ok(ex.top && ex.source === "cache" && !ex.offers.some((o) => o.canSubscribe), "Expert : aucune montée, source cache signalée");
  const ind = planView({ ent: { source: "indeterminate" } });
  ok(ind.indeterminate && ind.current === null && !ind.offers.some((o) => o.canSubscribe), "indéterminé : jamais affiché gratuit, aucun bouton (Q1)");
  ok(PLAN_OFFERS.every((o) => Array.from({ length: o.features }, (_, i) => CATALOGS.fr[`plan.feature.${o.id}.${i + 1}`] && CATALOGS.en[`plan.feature.${o.id}.${i + 1}`]).every(Boolean)), "chaque argument d'offre traduit en/fr");
}

console.log("\n── 3. Coûts produits : groupement, formulaires, erreurs ──");
{
  const rows = [
    { variant_id: "v1", product_id: "A", product_title: "Tee", source: "confirmed", stored: true, categorie: "Textile", customs_confirmed: true },
    { variant_id: "v2", product_id: "A", product_title: "Tee", source: "estimated", stored: false, categorie: "Textile" },
    { variant_id: "v3", product_id: "B", product_title: "Poster", source: "estimated", stored: false, categorie: "Autre" },
    { variant_id: "v4", product_id: "C", product_title: "Cap", source: "imported", stored: true, categorie: "Accessoires", customs_confirmed: false },
    { variant_id: "v5", product_id: "C", product_title: "Cap", source: "confirmed", stored: true, categorie: "Textile", customs_confirmed: true },
  ];
  const g = groupProducts(rows);
  const by = Object.fromEntries(g.map((p) => [p.product_id, p]));
  ok(g.map((p) => p.title).join(",") === "Cap,Poster,Tee" && by.A.status.key === "partial" && by.B.status.key === "todo" && by.C.status.key === "complete", "groupement par produit, tri par titre, statuts (partiel, à compléter, complet)");
  ok(by.A.customs && by.A.customs.estimated === false && by.B.customs === null && by.C.customs.estimated === true && by.C.customs.divergent === true && by.C.customs.category === null, "douane : seules les variantes stockées comptent ; divergence détectée");
  const c = statusCounts(g);
  ok(c.all === 3 && c.todo === 1 && c.partial === 1 && c.complete === 1 && filterProducts(g, "todo").length === 1 && filterProducts(g, "zzz").length === 3, "compteurs et filtres (filtre inconnu → tous)");
  const f = fd({ vid_0: "v2", prix_achat_0: "20,5", port_entrant_0: "0", qty_par_lot_0: "", cout_emballage_0: "0,3", vat_regime_0: "assujetti", shipping_model_0: "stock", pays_import_0: "Inde", categorie_0: "Textile" });
  const r = parseProductForm(f, { productId: "A" });
  ok(r.rows.length === 1 && r.errors.length === 0 && r.skipped.length === 0 && r.rows[0].value.prix_achat === 20.5 && r.rows[0].value.qty_par_lot === 1 && r.rows[0].value.cout_emballage === 0.3 && r.rows[0].value.shipping_model === "stock" && r.rows[0].product_id === "A", "formulaire : virgule acceptée, quantité par lot vide = 1 (seule exception), selects lus, produit rattaché");
  const sk = parseProductForm(fd({ vid_0: "v2", prix_achat_0: "20", port_entrant_0: "", qty_par_lot_0: "1", cout_emballage_0: "", vat_regime_0: "assujetti", shipping_model_0: "stock", pays_import_0: "Inde", categorie_0: "Textile", vid_1: "v3", prix_achat_1: "", port_entrant_1: "", qty_par_lot_1: "", cout_emballage_1: "", vat_regime_1: "assujetti", shipping_model_1: "stock", pays_import_1: "Chine", categorie_1: "Autre" }), { productId: "A" });
  ok(sk.rows.length === 0 && sk.errors.length === 0 && sk.skipped.length === 2 && sk.skipped[0].empty.join(",") === "port_entrant,cout_emballage" && sk.skipped[1].empty.join(",") === "prix_achat,port_entrant,cout_emballage", "arbitrage (c) : un champ de coût vide = non renseigné, variante non enregistrée, jamais la suggestion");
  const bad = parseProductForm(fd({ vid_0: "v3", prix_achat_0: "-1", port_entrant_0: "x", qty_par_lot_0: "0", cout_emballage_0: "0", vat_regime_0: "zz", shipping_model_0: "stock", pays_import_0: "Chine", categorie_0: "Autre" }));
  ok(bad.rows.length === 0 && bad.errors.length === 1 && ["prix_achat", "port_entrant", "qty_par_lot", "vat_regime"].every((k) => bad.errors[0].fields.includes(k)) && bad.errors[0].issues.find((x) => x.field === "prix_achat").reason === "negative", "erreurs : prix négatif, texte, quantité < 1, régime inconnu → champs signalés avec leur raison");
  const zero = parseProductForm(fd({ vid_0: "v4", prix_achat_0: "0", port_entrant_0: "0", qty_par_lot_0: "", cout_emballage_0: "0", vat_regime_0: "assujetti", shipping_model_0: "stock", pays_import_0: "Chine", categorie_0: "Autre" }));
  ok(zero.rows.length === 1 && zero.rows[0].value.prix_achat === 0, "règle du 2026-09-26 : 0 saisi = vrai 0 (prix d'achat compris), enregistré ; vide = non renseigné");
  ok(COST_FIELDS.length === 8 && NUMBER_FIELDS.length === 4, "8 champs par variante (4 nombres, 4 listes)");
}

console.log("\n── 4. Intégrité, catalogues, scans ──");
{
  const srv = read("app/lib/productCosts.server.js");
  const loadBody = srv.slice(srv.indexOf("export async function loadProductCosts"), srv.indexOf("// Enregistrement d'un produit"));
  ok(!/\.upsert\(|\.insert\(|\.update\(/.test(loadBody), "ouverture de la page : aucune écriture (règle d'intégrité de l'écran classique)");
  ok(/source: "confirmed"/.test(srv) && /source: "imported"/.test(srv) && (srv.match(/applyCustomsInvalidation\(/g) ?? []).length === 2 && /confirmCustomsCategory\(/.test(srv), "enregistrement 'confirmed', import 'imported', invalidation douane sur les deux, confirmation via le chemin existant");
  ok(/from\("shop_settings"\)/.test(srv) && !/from\("shop_plans"\)/.test(srv), "réglages par défaut lus dans shop_settings (source de vérité S1)");
  const route = read("app/routes/app.settings.products.jsx");
  ok(!/productSuggestions|sug\[f\]/.test(route + read("app/lib/productCosts.js")) && /rule: "cost_coverage"/.test(route) && /rule: "landed_cost"/.test(route), "aucune suggestion enregistrée (arbitrage c) ; data_fixed explicite sur les coûts et la douane (S10)");
  const ui = read("app/components/settings/ProductCosts.jsx");
  ok(/data-save-bar=""/.test(ui) && !/useState|onChange=|useFetcher/.test(ui) && /placeholder=\{ph\(r, f\)\}/.test(ui), "portage : formulaires natifs, barre de sauvegarde, aucun état React, suggestions en exemples");
  ok(PAYS_KEYS.every((k) => CATALOGS.en[`productcosts.country.${k}`] && CATALOGS.fr[`productcosts.country.${k}`]) && CATEGORIE_KEYS.every((k) => CATALOGS.en[`productcosts.category.${k}`]) && COST_FIELDS.every((k) => CATALOGS.fr[`productcosts.field.${k}`] && CATALOGS.en[`productcosts.error.${k}`]), "pays, catégories, champs et erreurs traduits en/fr");
  ok(!/app\._index/.test(route + read("app/routes/app.settings.plan.jsx")), "aucune dépendance aux routes de l'écran classique");
  ok(read("package.json").includes("lot32_plan_costs"), "lot 32 dans la chaîne de tests");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0 ? " BILAN LOT 32 (Offre + Coûts produits) : ✓ Tous les tests passent" : ` BILAN LOT 32 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
