// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Brique A — helpers purs coûts par variante (estimation / validation / CSV)
//  Importe le VRAI module (app/lib/variantCosts.js). Ne touche PAS engine.js ni la marge.
//  Pour lancer : node tests/lot5_variant_costs.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  estimateVariantCost, validateCostRow, parseCostsCsv, buildCostsCsv,
  buildCostRowsForDisplay, productCostStatus,
  PAYS_KEYS, CATEGORIE_KEYS, VAT_REGIMES, SHIPPING_MODELS, CSV_COLUMNS,
} from "../app/lib/variantCosts.js";
import { SHIPPING_ESTIMATES } from "../app/lib/engine.js";

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) failures++; };

// ── Estimation : réutilise les vraies sources, défauts neutres pour le reste ──
console.log("\n── Estimation auto ──");
{
  const e = estimateVariantCost({ unitCost: "12.50", categoryName: null, productType: "T-shirt coton", title: "Tee", defaultCountry: "Chine", vatRegime: "franchise", shippingModel: "stock" });
  ok(e.prix_achat === 12.5, `prix_achat = unitCost réel (${e.prix_achat})`);
  ok(e.port_entrant === SHIPPING_ESTIMATES.Chine, `port = SHIPPING_ESTIMATES[Chine] (${e.port_entrant})`);
  ok(e.categorie === "Textile", `catégorie mappée depuis productType (${e.categorie})`);
  ok(e.vat_regime === "franchise" && e.shipping_model === "stock", "vat/shipping = réglages boutique");
  ok(e.qty_par_lot === 1 && e.cout_emballage === 0, "défauts neutres qty=1, emballage=0");
  ok(e.source === "estimated", "source = estimated (jamais présenté comme confirmé)");

  const noCost = estimateVariantCost({ unitCost: null, productType: "inconnu", defaultCountry: "Zzz" });
  ok(noCost.prix_achat === 0, "unitCost absent → prix_achat 0");
  ok(noCost.categorie === "Autre", "type non reconnu → catégorie Autre");
  ok(noCost.pays_import === "Chine", "pays invalide → fallback Chine");
}

// ── Validation : numériques bornés + enums stricts ──
console.log("\n── Validation ──");
{
  const good = validateCostRow({ prix_achat: "10", port_entrant: "8", qty_par_lot: "100", cout_emballage: "0.5", vat_regime: "assujetti", shipping_model: "dropshipping", pays_import: "Chine", categorie: "Sport" });
  ok(good.errors.length === 0 && good.value, "ligne valide acceptée");
  ok(good.value.qty_par_lot === 100, "qty_par_lot parsé en entier");

  const bad = validateCostRow({ prix_achat: "-5", port_entrant: "x", qty_par_lot: "1.5", cout_emballage: "0", vat_regime: "tva", shipping_model: "avion", pays_import: "Mars", categorie: "Licorne" });
  ok(bad.value === null, "ligne invalide rejetée (value null)");
  ok(bad.errors.length === 7, `7 erreurs distinctes remontées — prix/port/qty/vat/shipping/pays/catégorie (${bad.errors.length})`);
  ok(bad.errors.some(m => m.includes("prix d'achat fournisseur")), "prix négatif refusé (message dédié)");
  ok(bad.errors.some(m => m.includes("qty_par_lot")), "qty non entière refusée");
  ok(bad.errors.some(m => m.includes("pays_import")), "pays hors domaine refusé");

  // Intégrité (ère XV) : prix d'achat ≤ 0 = coût fictif → refusé, message dédié, zéro écriture.
  const base = { port_entrant: "8", qty_par_lot: "1", cout_emballage: "0", vat_regime: "assujetti", shipping_model: "dropshipping", pays_import: "Chine", categorie: "Sport" };
  const zero = validateCostRow({ ...base, prix_achat: "0" });
  ok(zero.value === null, "prix d'achat 0 → ligne refusée (coût fictif)");
  ok(zero.errors.some(m => m.includes("Indiquez le prix d'achat fournisseur")), "prix 0 → message « Indiquez le prix d'achat fournisseur »");
  ok(validateCostRow({ ...base, prix_achat: "0,01" }).value !== null, "prix d'achat > 0 (0,01) accepté");

  ok(VAT_REGIMES.length === 2 && SHIPPING_MODELS.length === 2, "enums vat/shipping fermés");
  ok(PAYS_KEYS.includes("Chine") && CATEGORIE_KEYS.includes("Autre"), "domaines pays/catégorie = clés moteur");
}

// ── CSV : round-trip + erreurs ligne par ligne, jamais avalées ──
console.log("\n── CSV import / export ──");
{
  const items = [
    { variant_id: "gid://1", product_title: "Pull, laine", variant_title: "M", prix_achat: 12, port_entrant: 8, qty_par_lot: 50, cout_emballage: 0.5, vat_regime: "assujetti", shipping_model: "stock", pays_import: "Chine", categorie: "Textile" },
  ];
  const csv = buildCostsCsv(items);
  ok(csv.split("\r\n")[0] === CSV_COLUMNS.join(","), "en-tête = CSV_COLUMNS");
  ok(csv.includes('"Pull, laine"'), "titre avec virgule échappé entre guillemets");

  const round = parseCostsCsv(csv);
  ok(round.errors.length === 0 && round.rows.length === 1, "round-trip : 1 ligne valide, 0 erreur");
  ok(round.rows[0].variant_id === "gid://1", "variant_id préservé");
  ok(round.rows[0].value.qty_par_lot === 50 && round.rows[0].value.categorie === "Textile", "valeurs persistées correctes");

  const badCsv = "variant_id,prix_achat,port_entrant,qty_par_lot,cout_emballage,vat_regime,shipping_model,pays_import,categorie\n"
    + "gid://2,10,8,1,0,assujetti,dropshipping,Chine,Sport\n"        // valide
    + "gid://3,-1,8,1,0,assujetti,dropshipping,Chine,Sport\n"        // prix négatif
    + ",10,8,1,0,assujetti,dropshipping,Chine,Sport\n";             // variant_id manquant
  const res = parseCostsCsv(badCsv);
  ok(res.rows.length === 1, "1 ligne valide retenue");
  ok(res.errors.length === 2, `2 lignes en erreur rapportées (${res.errors.length})`);
  ok(res.errors[0].line === 3 && res.errors[1].line === 4, "numéros de ligne corrects (3 et 4)");

  const noHeader = parseCostsCsv("foo,bar\n1,2");
  ok(noHeader.rows.length === 0 && noHeader.errors[0].messages[0].includes("Colonnes manquantes"), "en-tête incomplet → erreur claire, rien importé");
}

// NB (ère XV) : le bloc « reconcileEstimatedCost » a été RETIRÉ avec la fonction (code mort de
// réhydratation-écriture, incompatible avec costs_list en lecture seule). La garantie de fond — une
// donnée marchand (confirmed/imported) fait autorité et n'est jamais écrasée — est désormais portée par
// buildCostRowsForDisplay (ci-dessous : ligne stockée renvoyée telle quelle) et par le refus de tout
// prix d'achat ≤ 0 dans validateCostRow (ci-dessus). Aucune couverture perdue.

// ── buildCostRowsForDisplay : LECTURE SEULE, jamais de pré-rempli persisté (intégrité ère XV) ──
// Preuve d'intégrité n°2 au niveau du constructeur pur : une variante sans ligne stockée reçoit une
// SUGGESTION estimée taguée stored:false (affichage), jamais un payload d'écriture ; une ligne stockée
// fait autorité (stored:true). costs_list n'appelle plus que cette fonction + un SELECT → zéro écriture.
console.log("\n── buildCostRowsForDisplay : suggestion display-only vs ligne stockée ──");
{
  const variants = [
    { variant_id: "v1", product_id: "p1", product_title: "Tee", variant_title: "M", price: 20, unitCost: "12.50", categoryName: null, productType: "T-shirt" },
    { variant_id: "v2", product_id: "p1", product_title: "Tee", variant_title: "L", price: 20, unitCost: null, categoryName: null, productType: "T-shirt" },
  ];
  // Aucune ligne stockée (compte neuf) → chaque variante = SUGGESTION estimée, stored:false.
  const fresh = buildCostRowsForDisplay({ variants, storedMap: new Map(), defaultCountry: "Chine", vatRegime: "assujetti", shippingModel: "stock" });
  ok(fresh.length === 2, "toutes les variantes rendues pour l'affichage");
  ok(fresh.every(r => r.stored === false), "sans ligne stockée → stored:false (suggestion, jamais offerte à la confirmation douane)");
  ok(fresh.every(r => r.source === "estimated"), "suggestion display-only marquée source estimated");
  ok(fresh[0].prix_achat === 12.5, "suggestion : prix_achat reflète le unitCost Shopify");
  // Ligne stockée (confirmée) → autorité, renvoyée telle quelle, stored:true.
  const stored = new Map([["v1", { source: "confirmed", prix_achat: 9, categorie: "Sport", customs_confirmed: true }]]);
  const mixed = buildCostRowsForDisplay({ variants, storedMap: stored, defaultCountry: "Chine", vatRegime: "assujetti", shippingModel: "stock" });
  const r1 = mixed.find(r => r.variant_id === "v1");
  ok(r1.stored === true && r1.source === "confirmed" && r1.prix_achat === 9, "ligne stockée → stored:true, valeurs marchand préservées");
  ok(mixed.find(r => r.variant_id === "v2").stored === false, "variante non stockée du même produit → stored:false");
  // Pureté : deux appels identiques → sortie identique (aucun effet de bord, aucun I/O).
  const a = JSON.stringify(buildCostRowsForDisplay({ variants, storedMap: new Map(), defaultCountry: "Chine" }));
  const b = JSON.stringify(buildCostRowsForDisplay({ variants, storedMap: new Map(), defaultCountry: "Chine" }));
  ok(a === b, "pur : appels répétés identiques (aucun effet de bord, aucune écriture)");
}

// ── productCostStatus : complétude d'un produit (« renseigné » = saisie marchand seulement) ──
console.log("\n── productCostStatus : complet / partiel / à compléter ──");
{
  ok(productCostStatus([{ source: "confirmed" }, { source: "imported" }]).key === "complete", "toutes confirmées/importées → complete");
  ok(productCostStatus([{ source: "estimated" }, { source: "estimated" }]).key === "todo", "toutes estimées (suggestion) → à compléter");
  ok(productCostStatus([{ source: "estimated" }]).key === "todo" && productCostStatus([]).key === "todo", "estimée seule / aucune variante → à compléter");
  const partial = productCostStatus([{ source: "confirmed" }, { source: "estimated" }, { source: "estimated" }]);
  ok(partial.key === "partial" && partial.label === "Partiel : 1 variante sur 3", "1 confirmée sur 3 → « Partiel : 1 variante sur 3 »");
  ok(productCostStatus([{ source: "confirmed" }, { source: "confirmed" }, { source: "estimated" }]).label === "Partiel : 2 variantes sur 3", "pluriel « 2 variantes »");
}

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 5 (coûts par variante) : ✓ Tous les tests passent"
  : ` BILAN LOT 5 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
