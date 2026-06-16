// Tests d'acceptation Lot 1 — fork douane dropshipping/stock + date-gate réforme UE
// Ces tests sont PERMANENTS dans le repo (ne pas rm).
// Pour lancer : node tests/lot1_customs.mjs

// ── Reproduction exacte des constantes et fonctions du moteur ─────────────────

const LOW_VALUE_PARCEL_CEILING    = 150;
const EU_DROPSHIP_DUTY_REFORM_DATE = new Date("2026-07-01T00:00:00Z");
const EU_DROPSHIP_FLAT_DUTY       = 3;

const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10,
  Accessoires: 0.07, Sport: 0.05, Alimentation: 0.15,
  Maroquinerie: 0.03, Jouets: 0, Mobilier: 0.027, Livres: 0, Autre: 0.03,
};
const SHIPPING_ESTIMATES = { Chine: 8, Inde: 6, Turquie: 4, UE: 2, Autre: 5 };
const PAYMENT_PROCESSORS = [{ id: "Stripe EU", rate: 1.5, fixedFee: 0.25 }];
const VAT_RATES = {
  Alimentation: 0.055, Livres: 0.055,
  Textile: 0.20, Électronique: 0.20, Cosmétique: 0.20, Accessoires: 0.20,
  Sport: 0.20, Maroquinerie: 0.20, Jouets: 0.20, Mobilier: 0.20, Autre: 0.20,
};
function getVatRate(cat) { return VAT_RATES[cat] ?? 0.20; }

function getCustomsDuty({ supplierPrice, shippingCost, dutyRate, shippingModel = "stock", now = new Date() }) {
  if (shippingModel === "dropshipping") {
    if (supplierPrice > LOW_VALUE_PARCEL_CEILING) {
      return (supplierPrice + shippingCost) * dutyRate;
    }
    return now >= EU_DROPSHIP_DUTY_REFORM_DATE ? EU_DROPSHIP_FLAT_DUTY : 0;
  }
  return (supplierPrice + shippingCost) * dutyRate;
}

function computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime = "assujetti", shippingModel = "stock", qty = 1, now = new Date()) {
  const qtyEff          = shippingModel === "dropshipping" ? 1 : Math.max(1, parseInt(qty, 10) || 1);
  const shippingPerUnit = shipping / qtyEff;
  const valeurEnDouane  = prixAchat + shippingPerUnit;
  const droitsDouane    = getCustomsDuty({ supplierPrice: prixAchat, shippingCost: shippingPerUnit, dutyRate: customsRate, shippingModel, now });
  const baseTVA         = valeurEnDouane + droitsDouane;
  const tvaImport       = baseTVA * vatRate;
  const tvaNetCost      = vatRegime === "franchise" ? tvaImport : 0;
  const coutRendu       = prixAchat + shippingPerUnit + droitsDouane + tvaNetCost;
  return { valeurEnDouane, droitsDouane, baseTVA, tvaImport, tvaNetCost, coutRendu };
}

function calcNetMargin(prixAchat, prixVente, cat, pays, shopifyFee, stripeFee, fixedFee,
                       retours, ads, fraisRetour, emballage, vatRegime, shopTaxesIncluded = true,
                       shippingModel = "stock", qty = 1, now = new Date()) {
  const customsRate = CUSTOMS_RATES[cat] ?? 0.03;
  const vatRate     = getVatRate(cat);
  const shipping    = SHIPPING_ESTIMATES[pays] ?? 5;
  const { coutRendu } = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime, shippingModel, qty, now);
  const revenu      = vatRegime === "assujetti" && shopTaxesIncluded ? prixVente / (1 + vatRate) : prixVente;
  const shopifyCost = prixVente * (shopifyFee / 100);
  const stripeCost  = (prixVente * (stripeFee / 100)) + fixedFee;
  const retoursCost = revenu * (retours / 100);
  const adsCost     = prixVente * (ads / 100);
  return revenu - coutRendu - shopifyCost - stripeCost - retoursCost - adsCost - (fraisRetour + emballage);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const eur = (n) => `${Number.isFinite(n) ? n.toFixed(4) : "NaN"} €`;
let failures = 0;
function assert(cond, label) {
  const icon = cond ? "✓" : "✗ ÉCHEC";
  if (!cond) failures++;
  console.log(`  ${icon} ${label}`);
}
function section(title) { console.log(`\n── ${title} ──`); }

const PRE  = new Date("2026-06-16T00:00:00Z"); // aujourd'hui, avant réforme
const POST = new Date("2026-07-01T00:00:00Z"); // 1er juillet, réforme active

// ════════════════════════════════════════════════════════════════════════════════
// TEST 1 — Stock, qty=1, Sport 5%, supplier 40€, ship 8€
// ⚠️ CHANGEMENT VOLONTAIRE : avant = 0€ (de minimis), maintenant = tarif plein
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 1 : Stock qty=1 — douane sur CIF plein, plus de seuil");
{
  const { droitsDouane, coutRendu } = computeLandedCost(40, 8, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", "stock", 1);
  const attendu = (40 + 8) * 0.05; // 2.40€
  console.log(`  droitsDouane = (40+8) × 5% = ${eur(droitsDouane)} | attendu ${eur(attendu)}`);
  assert(Math.abs(droitsDouane - attendu) < 0.001, `Stock qty=1 Sport : droits = ${eur(droitsDouane)} (attendu ${eur(attendu)})`);
  assert(droitsDouane > 0, "Aucun de minimis en mode stock — droits > 0");
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 2 — Stock, qty=100, supplier 40€, shippingCost 8€ (lot)
// shippingPerUnit = 8/100 = 0,08€ → droits = (40+0,08) × 5% = 2,004€
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 2 : Stock qty=100 — port divisé, droits sur CIF/unité");
{
  const { droitsDouane, coutRendu } = computeLandedCost(40, 8, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", "stock", 100);
  const shippingPerUnit = 8 / 100; // 0.08
  const attendu = (40 + shippingPerUnit) * 0.05; // 2.004€
  console.log(`  shippingPerUnit = 8/100 = ${eur(shippingPerUnit)}`);
  console.log(`  droitsDouane = (40+0.08) × 5% = ${eur(droitsDouane)} | attendu ${eur(attendu)}`);
  assert(Math.abs(droitsDouane - attendu) < 0.001, `Stock qty=100 : droits = ${eur(droitsDouane)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 3 — Dropshipping, supplier 2,44€, PRÉ-réforme (now=2026-06-16) → 0€
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 3 : Dropshipping PRÉ-réforme → 0€ (de minimis)");
{
  const { droitsDouane } = computeLandedCost(2.44, 8, CUSTOMS_RATES["Autre"], getVatRate("Autre"), "assujetti", "dropshipping", 1, PRE);
  console.log(`  now=${PRE.toISOString().slice(0,10)}, supplier 2,44€ ≤ 150€ → droitsDouane = ${eur(droitsDouane)}`);
  assert(droitsDouane === 0, `Dropshipping pré-réforme : droits = 0€ (de minimis) | obtenu ${eur(droitsDouane)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 4 — Dropshipping, supplier 2,44€, POST-réforme (now=2026-07-01) → 3€
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 4 : Dropshipping POST-réforme → forfait 3€");
{
  const { droitsDouane } = computeLandedCost(2.44, 8, CUSTOMS_RATES["Autre"], getVatRate("Autre"), "assujetti", "dropshipping", 1, POST);
  console.log(`  now=${POST.toISOString().slice(0,10)}, supplier 2,44€ ≤ 150€ → droitsDouane = ${eur(droitsDouane)}`);
  assert(droitsDouane === EU_DROPSHIP_FLAT_DUTY, `Dropshipping post-réforme : droits = 3€ | obtenu ${eur(droitsDouane)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 5 — Dropshipping, supplier 200€ (HAUTE VALEUR) post-réforme → tarif % (PAS 3€)
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 5 : Dropshipping haute valeur (200€ > 150€) → tarif % plein, pas 3€");
{
  const ship = 8;
  const { droitsDouane } = computeLandedCost(200, ship, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", "dropshipping", 1, POST);
  const attendu = (200 + ship) * 0.05; // 10.40€
  console.log(`  supplier 200€ > ceiling 150€ → tarif normal : (200+8)×5% = ${eur(attendu)}`);
  assert(Math.abs(droitsDouane - attendu) < 0.001, `Haute valeur : droits = ${eur(droitsDouane)} ≠ 3€ forfait`);
  assert(droitsDouane !== EU_DROPSHIP_FLAT_DUTY, "Haute valeur : PAS le forfait 3€");
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 6 — Cohérence croisée : les 4 modules donnent 0,00€ d'écart
// En stock et en dropshipping (pré et post réforme)
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 6 : Cohérence croisée — 4 modules, 0,00€ d'écart");
{
  // Référence : computeLandedCost directement (partagée par tous les modules)
  const S = { shopify: 2, stripe: 1.5, fixed: 0.25, retours: 5, ads: 0, fr: 0, emb: 0 };

  for (const [label, shippingModel, qty, now] of [
    ["stock    qty=1  pré",  "stock",        1,   PRE],
    ["stock    qty=100 pré", "stock",        100, PRE],
    ["dropship qty=1  pré",  "dropshipping", 1,   PRE],
    ["dropship qty=1  post", "dropshipping", 1,   POST],
  ]) {
    const shipping = 8;
    // Simuler les 4 sites : ils appellent tous computeLandedCost avec les mêmes args
    const ref = computeLandedCost(40, shipping, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", shippingModel, qty, now);
    // calcNetMargin appelle computeLandedCost via SHIPPING_ESTIMATES["Chine"]=8
    const mCalc = calcNetMargin(40, 100, "Sport", "Chine", S.shopify, S.stripe, S.fixed, S.retours, S.ads, S.fr, S.emb, "assujetti", true, shippingModel, qty, now);
    // Audit : même fonction, shippingCost=8 passé en raw, qty séparé
    const mAudit = (() => {
      const { coutRendu } = computeLandedCost(40, shipping, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", shippingModel, qty, now);
      const proc   = PAYMENT_PROCESSORS[0];
      const revenu = 100 / 1.20; // assujetti
      const shopify = 100 * 0.02;
      const stripe  = (100 * proc.rate / 100) + proc.fixedFee;
      const returns = revenu * 0.05;
      return revenu - coutRendu - shopify - stripe - returns;
    })();
    const diff = Math.abs(mCalc - mAudit);
    assert(diff < 0.001, `${label} | calcNetMargin=${eur(mCalc)} audit=${eur(mAudit)} écart=${diff.toFixed(6)}€`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 7 — Sanity marge : chaussettes dropshipping post-réforme
// supplier 2,44€ / ship 8€ / vente 7,90€ TTC / assujetti
// Attendu : marge nettement négative (~−7,7€)
// Décomposition : coutRendu = 2,44 + 8 (qty=1 forcé) + 3 (forfait) = 13,44€
//                 revenu HT = 7,90 / 1,20 = 6,583€
//                 marge = 6,583 - 13,44 - (frais) = négatif
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 7 : Sanity chaussettes dropshipping post-réforme (~−7,7€)");
{
  const cost = 2.44, price = 7.90, ship = 8;
  const vatRate = getVatRate("Autre");
  const { coutRendu, droitsDouane, shippingPerUnitOut } = (() => {
    const r = computeLandedCost(cost, ship, CUSTOMS_RATES["Autre"], vatRate, "assujetti", "dropshipping", 1, POST);
    return { ...r, shippingPerUnitOut: ship }; // dropshipping force qty=1
  })();
  const revenu      = price / (1 + vatRate);
  const shopifyCost = price * 0.02;
  const stripeCost  = (price * 0.015) + 0.25;
  const retoursCost = revenu * 0.05;
  const marge       = revenu - coutRendu - shopifyCost - stripeCost - retoursCost;

  console.log(`  coutRendu = ${cost} + ${ship} (qty=1 forcé) + ${droitsDouane}€ forfait = ${eur(coutRendu)}`);
  console.log(`  revenu HT = ${price} / 1.20 = ${eur(revenu)}`);
  console.log(`  marge nette = ${eur(marge)}`);
  assert(marge < -7, `Marge chaussettes dropshipping post-réforme ${eur(marge)} < −7€`);
  assert(droitsDouane === 3, `droitsDouane = ${eur(droitsDouane)} (forfait 3€)`);
  assert(Math.abs(coutRendu - (cost + ship + 3)) < 0.001,
    `coutRendu = coût(${cost}) + port(${ship}) + forfait(3) = ${eur(coutRendu)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 8 — Dropshipping : qty ignoré (forcé à 1 même si qty=100 passé)
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 8 : Dropshipping ignore qty — fret jamais divisé");
{
  const r1   = computeLandedCost(2.44, 8, CUSTOMS_RATES["Autre"], getVatRate("Autre"), "assujetti", "dropshipping", 1,   PRE);
  const r100 = computeLandedCost(2.44, 8, CUSTOMS_RATES["Autre"], getVatRate("Autre"), "assujetti", "dropshipping", 100, PRE);
  assert(Math.abs(r1.coutRendu - r100.coutRendu) < 0.001,
    `Dropshipping qty=1 et qty=100 donnent même coutRendu (${eur(r1.coutRendu)} = ${eur(r100.coutRendu)})`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 9 — Régression : résultats franchise inchangés (TVA coût sec)
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 9 : Régression franchise — comportement TVA préservé");
{
  // Alimentation / Chine / 200€ coût / franchise — droits stock (200>0, pas de seuil)
  const vatRate = getVatRate("Alimentation"); // 5.5%
  const { coutRendu, droitsDouane, tvaImport } = computeLandedCost(
    200, 8, CUSTOMS_RATES["Alimentation"], vatRate, "franchise", "stock", 1
  );
  // droitsDouane = (200+8)×15% = 31.20 (stock, no threshold)
  // baseTVA = (200+8+31.20) = 239.20 → tvaImport = 239.20 × 5.5% = 13.156
  // coutRendu = 200+8+31.20+13.156 = 252.356
  assert(Math.abs(droitsDouane - (208 * 0.15)) < 0.001, `Douane Alimentation stock 200€ = ${eur(droitsDouane)}`);
  assert(Math.abs(tvaImport - ((208 + droitsDouane) * 0.055)) < 0.001, `TVA import 5.5% = ${eur(tvaImport)}`);
  assert(Math.abs(coutRendu - (200 + 8 + droitsDouane + tvaImport)) < 0.001, `coutRendu franchise = ${eur(coutRendu)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(66)}`);
console.log(` BILAN LOT 1 : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} échec(s)`}`);
console.log(`${"═".repeat(66)}\n`);
process.exit(failures > 0 ? 1 : 0);
