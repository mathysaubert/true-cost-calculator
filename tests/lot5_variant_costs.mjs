// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU Brique A — helpers purs coûts par variante (estimation / validation / CSV)
//  Importe le VRAI module (app/lib/variantCosts.js). Ne touche PAS engine.js ni la marge.
//  Pour lancer : node tests/lot5_variant_costs.mjs
// ════════════════════════════════════════════════════════════════════════════════

import {
  estimateVariantCost, validateCostRow, parseCostsCsv, buildCostsCsv,
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
  ok(bad.errors.some(m => m.includes("prix_achat")), "prix négatif refusé");
  ok(bad.errors.some(m => m.includes("qty_par_lot")), "qty non entière refusée");
  ok(bad.errors.some(m => m.includes("pays_import")), "pays hors domaine refusé");

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

console.log("\n" + "═".repeat(66));
console.log(failures === 0
  ? " BILAN LOT 5 (coûts par variante) : ✓ Tous les tests passent"
  : ` BILAN LOT 5 : ✗ ${failures} assertion(s) en échec`);
console.log("═".repeat(66));
process.exit(failures === 0 ? 0 : 1);
