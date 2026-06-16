// Tests de réconciliation CPA max / Break-even ROAS
// Vérifie que CPA max = margeNette quand ads=0, et les valeurs réelles du bug.
// Pour lancer : node tests/lot3_cpa_roas.mjs

// ── Reproduction exacte du moteur (post Lot 2+3) ─────────────────────────────

const LOW_VALUE_PARCEL_CEILING     = 150;
const EU_DROPSHIP_DUTY_REFORM_DATE = new Date("2026-07-01T00:00:00Z");
const EU_DROPSHIP_FLAT_DUTY        = 3;
const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10, Accessoires: 0.07,
  Sport: 0.05, Alimentation: 0.15, Maroquinerie: 0.03, Jouets: 0,
  Mobilier: 0.027, Livres: 0, Autre: 0.03,
};
const SHIPPING_ESTIMATES = { Chine: 8, UE: 2, Autre: 5 };
const VAT_RATES = {
  Alimentation: 0.055, Livres: 0.055,
  Textile: 0.20, Électronique: 0.20, Cosmétique: 0.20, Accessoires: 0.20,
  Sport: 0.20, Maroquinerie: 0.20, Jouets: 0.20, Mobilier: 0.20, Autre: 0.20,
};
function getVatRate(cat) { return VAT_RATES[cat] ?? 0.20; }

function getCustomsDuty({ supplierPrice, shippingCost, dutyRate, shippingModel = "stock", now = new Date() }) {
  if (shippingModel === "dropshipping") {
    if (supplierPrice > LOW_VALUE_PARCEL_CEILING) return (supplierPrice + shippingCost) * dutyRate;
    return now >= EU_DROPSHIP_DUTY_REFORM_DATE ? EU_DROPSHIP_FLAT_DUTY : 0;
  }
  return (supplierPrice + shippingCost) * dutyRate;
}

function computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime = "assujetti", shippingModel = "stock", qty = 1, now = new Date()) {
  const qtyEff          = shippingModel === "dropshipping" ? 1 : Math.max(1, parseInt(qty, 10) || 1);
  const shippingPerUnit = shipping / qtyEff;
  const droitsDouane    = getCustomsDuty({ supplierPrice: prixAchat, shippingCost: shippingPerUnit, dutyRate: customsRate, shippingModel, now });
  const baseTVA         = (prixAchat + shippingPerUnit) + droitsDouane;
  const tvaImport       = baseTVA * vatRate;
  const tvaNetCost      = vatRegime === "franchise" ? tvaImport : 0;
  return prixAchat + shippingPerUnit + droitsDouane + tvaNetCost;
}

// Simule le calculate() callback complet tel qu'il existe dans l'app.
// Retourne l'objet r avec revenu, margeNette, shopifyCost, stripeCost, retoursCost, etc.
function simulate({ prixAchat, prixVente, categorie, paysImport, shopifyFee, stripeFee,
                    processorFixedFee, retours, ads, fraisRetour, coutEmballage,
                    vatRegime, shippingModel, shopTaxesIncluded, qty = 1, now = new Date() }) {
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const coutRendu   = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime, shippingModel, qty, now);
  const revenu      = vatRegime === "assujetti" && shopTaxesIncluded ? prixVente / (1 + vatRate) : prixVente;
  const shopifyCost = prixVente * (shopifyFee / 100);
  const stripeCost  = (prixVente * (stripeFee / 100)) + processorFixedFee;
  const retoursCost = revenu * (retours / 100);
  const adsCost     = prixVente * (ads / 100);
  const fraisFixes  = fraisRetour + coutEmballage;
  const margeBrute  = revenu - coutRendu;
  const margeNette  = margeBrute - shopifyCost - stripeCost - retoursCost - adsCost - fraisFixes;
  return { prixVente, revenu, coutRendu, shopifyCost, stripeCost, retoursCost, adsCost, fraisFixes, margeBrute, margeNette };
}

// Simule BreakEvenROAS.available APRÈS le fix (utilise revenu)
function computeCpaMax({ prixVente, revenu, coutRendu, shopifyCost, stripeCost, retoursCost, fraisFixes }) {
  const revenuEffectif = revenu ?? prixVente;
  return revenuEffectif - coutRendu - shopifyCost - stripeCost - retoursCost - fraisFixes;
}

// Simule BreakEvenROAS.available AVANT le fix (utilisait prixVente TTC)
function computeCpaMaxBug({ prixVente, coutRendu, shopifyCost, stripeCost, retoursCost, fraisFixes }) {
  return prixVente - coutRendu - shopifyCost - stripeCost - retoursCost - fraisFixes;
}

const eur  = (n) => `${Number.isFinite(n) ? n.toFixed(4) : "NaN"} €`;
const x    = (n) => `${Number.isFinite(n) ? n.toFixed(2) : "NaN"}x`;
let failures = 0;
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗ ÉCHEC"} ${label}`);
}
function section(t) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════════
// TEST 1 — Cas réel du bug (valeurs de l'énoncé)
// prixVente=49,99 / prixAchat=? / coutRendu=24,63 / shopify=1 / stripe=1 / emb=12,60
// ads=0 (exclus du CPA max), retours=0, assujetti, taxesIncluded=true
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 1 : Cas réel — valeurs de l'énoncé");
{
  // Reconstruction des inputs qui donnent coutRendu=24.63
  // On mock directement les valeurs extraites de results pour être fidèle à l'énoncé
  const prixVente   = 49.99;
  const coutRendu   = 24.63;
  const shopifyCost = 1.00;   // ~2% de 49.99
  const stripeCost  = 1.00;   // ~1.5% + fixe
  const retoursCost = 0;      // retours=0 dans ce cas
  const fraisFixes  = 12.60;  // emballage
  const vatRate     = 0.20;   // Sport/standard
  const revenu      = prixVente / (1 + vatRate); // 41.6583...

  const cpaMaxBug = computeCpaMaxBug({ prixVente, coutRendu, shopifyCost, stripeCost, retoursCost, fraisFixes });
  const cpaMaxFix = computeCpaMax({ prixVente, revenu, coutRendu, shopifyCost, stripeCost, retoursCost, fraisFixes });
  const roasBug   = prixVente / cpaMaxBug;
  const roasFix   = prixVente / cpaMaxFix;
  const tvaTolerance = Math.abs(cpaMaxBug - cpaMaxFix - (prixVente - revenu));

  console.log(`  revenu HT     = ${eur(revenu)} (49.99 / 1.20)`);
  console.log(`  CPA max AVANT = ${eur(cpaMaxBug)} (bug — TTC)`);
  console.log(`  CPA max APRÈS = ${eur(cpaMaxFix)} (fix — HT)`);
  console.log(`  ROAS AVANT    = ${x(roasBug)} | ROAS APRÈS = ${x(roasFix)}`);

  assert(Math.abs(cpaMaxBug - 10.76) < 0.01, `CPA max bug = 10.76€ (reproduit) | obtenu ${eur(cpaMaxBug)}`);
  assert(Math.abs(cpaMaxFix - 2.43)  < 0.01, `CPA max fix = 2.43€ (corrigé)   | obtenu ${eur(cpaMaxFix)}`);
  assert(Math.abs(roasFix - 20.6)    < 0.1,  `ROAS fix = ~20.6x               | obtenu ${x(roasFix)}`);
  assert(Math.abs(roasBug - 4.65)    < 0.1,  `ROAS bug = ~4.65x (reproduit)   | obtenu ${x(roasBug)}`);
  assert(tvaTolerance < 0.001, `Écart CPA = TVA collectée (${eur(prixVente - revenu)}) ← signature du bug`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 2 — RÉCONCILIATION : CPA max = margeNette quand ads=0
// Invariant fondamental : le CPA max est la marge avant pub
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 2 : Réconciliation CPA max = margeNette (ads=0)");
{
  const CASES = [
    { desc: "Sport/Chine/assujetti/stock",       cat: "Sport",        pays: "Chine", vr: "assujetti", sm: "stock",        ti: true },
    { desc: "Textile/Chine/assujetti/dropship",  cat: "Textile",      pays: "Chine", vr: "assujetti", sm: "dropshipping", ti: true },
    { desc: "Alimentation/Chine/franchise/stock",cat: "Alimentation", pays: "Chine", vr: "franchise", sm: "stock",        ti: true },
    { desc: "Sport/Chine/assujetti/taxesIncl=F", cat: "Sport",        pays: "Chine", vr: "assujetti", sm: "stock",        ti: false },
  ];

  for (const tc of CASES) {
    const r = simulate({
      prixAchat: 20, prixVente: 49.99, categorie: tc.cat, paysImport: tc.pays,
      shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25,
      retours: 5, ads: 0,           // ads=0 → CPA max = margeNette
      fraisRetour: 0, coutEmballage: 3,
      vatRegime: tc.vr, shippingModel: tc.sm, shopTaxesIncluded: tc.ti,
    });
    const cpaMax = computeCpaMax(r);
    const diff   = Math.abs(cpaMax - r.margeNette);
    console.log(`  ${tc.desc} | margeNette=${eur(r.margeNette)} cpaMax=${eur(cpaMax)} diff=${diff.toFixed(6)}€`);
    assert(diff < 0.001, `${tc.desc} : CPA max = margeNette au centime`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 3 — Shopify/Stripe restent TTC, seul revenu passe en HT
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 3 : Frais TTC inchangés — seul revenu passe en HT");
{
  const prixVente = 100;
  const r = simulate({
    prixAchat: 30, prixVente, categorie: "Sport", paysImport: "Chine",
    shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25,
    retours: 0, ads: 0, fraisRetour: 0, coutEmballage: 0,
    vatRegime: "assujetti", shippingModel: "stock", shopTaxesIncluded: true,
  });
  assert(Math.abs(r.shopifyCost - 2.00)  < 0.001, `Shopify 2% = 2.00€ sur TTC (${eur(r.shopifyCost)})`);
  assert(Math.abs(r.stripeCost  - 1.75)  < 0.001, `Stripe 1.5%+0.25 = 1.75€ sur TTC (${eur(r.stripeCost)})`);
  assert(r.revenu < prixVente, `revenu (${eur(r.revenu)}) < prixVente TTC (${eur(prixVente)})`);
  assert(Math.abs(r.revenu - prixVente / 1.20) < 0.001, `revenu = prixVente/1.20 (${eur(r.revenu)})`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 4 — ROAS utilise prixVente TTC (standard industrie)
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 4 : ROAS = prixVente (TTC) / CPA_max");
{
  const prixVente = 100;
  const r = simulate({
    prixAchat: 20, prixVente, categorie: "Sport", paysImport: "Chine",
    shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25,
    retours: 0, ads: 0, fraisRetour: 0, coutEmballage: 0,
    vatRegime: "assujetti", shippingModel: "stock", shopTaxesIncluded: true,
  });
  const cpaMax = computeCpaMax(r);
  const roas   = prixVente / cpaMax;
  assert(roas > 1, `ROAS = prixVente(TTC) / CPA_max = ${prixVente}/${eur(cpaMax)} = ${x(roas)}`);
  // ROAS = prixVente TTC / CPA (pas prixVente HT / CPA) — standard plateformes
  const roasHT = r.revenu / cpaMax;
  assert(roas > roasHT, `ROAS TTC (${x(roas)}) > ROAS HT (${x(roasHT)}) — TTC dénominateur standard`);
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST 5 — Non-régression : tests Lot 1 et Lot 2 sur les marges
// ════════════════════════════════════════════════════════════════════════════════
section("TEST 5 : Non-régression Lot 1 + Lot 2 — marges inchangées");
{
  const S = { shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25, retours: 5, ads: 0, fraisRetour: 0, coutEmballage: 0 };
  const PRE  = new Date("2026-06-16T00:00:00Z");
  const POST = new Date("2026-07-01T00:00:00Z");

  // Lot 2 + Lot 1 : assujetti, taxesIncluded=true, stock
  // Post-Lot-1 : douane stock 2.40€ (plus de de minimis), coutRendu=50.40 → marge ~25.02€
  const r1 = simulate({ prixAchat: 40, prixVente: 100, categorie: "Sport", paysImport: "Chine",
    ...S, vatRegime: "assujetti", shippingModel: "stock", shopTaxesIncluded: true });
  assert(Number.isFinite(r1.margeNette) && r1.margeNette > 0,
    `Assujetti stock : margeNette finie et positive (${eur(r1.margeNette)})`);
  // Franchise doit donner une marge plus élevée que assujetti (TVA import en coût sec → coutRendu
  // monte, MAIS la TVA collectée n'est pas retirée du revenu → gain net ≈ TVA collectée − TVA import)
  const r2 = simulate({ prixAchat: 40, prixVente: 100, categorie: "Sport", paysImport: "Chine",
    ...S, vatRegime: "franchise", shippingModel: "stock", shopTaxesIncluded: true });
  assert(Number.isFinite(r2.margeNette), `Franchise stock : margeNette finie (${eur(r2.margeNette)})`);
  console.log(`  assujetti stock margeNette=${eur(r1.margeNette)} | franchise stock margeNette=${eur(r2.margeNette)}`);

  // Lot 1 : dropshipping pré-réforme (prixAchat=40)
  const r3 = simulate({ prixAchat: 40, prixVente: 100, categorie: "Sport", paysImport: "Chine",
    ...S, vatRegime: "assujetti", shippingModel: "dropshipping", shopTaxesIncluded: true, now: PRE });
  assert(Math.abs(r3.margeNette - 27.42) < 0.01, `Lot 1 dropship pré    : margeNette=${eur(r3.margeNette)} (attendu ~27.42€)`);

  // Lot 1 : dropshipping post-réforme (3€ forfait, prixAchat=40)
  const r4 = simulate({ prixAchat: 40, prixVente: 100, categorie: "Sport", paysImport: "Chine",
    ...S, vatRegime: "assujetti", shippingModel: "dropshipping", shopTaxesIncluded: true, now: POST });
  assert(r4.margeNette < r3.margeNette, `Lot 1 dropship post < pré (3€ forfait) : ${eur(r4.margeNette)} < ${eur(r3.margeNette)}`);

  // CPA max = margeNette (ads=0) dans tous ces cas
  for (const [label, r] of [["assujetti stock", r1], ["franchise", r2], ["dropship pré", r3], ["dropship post", r4]]) {
    const cpa = computeCpaMax(r);
    assert(Math.abs(cpa - r.margeNette) < 0.001, `CPA=margeNette ${label} : ${eur(cpa)} = ${eur(r.margeNette)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(66)}`);
console.log(` BILAN LOT 3 (CPA) : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} échec(s)`}`);
console.log(`${"═".repeat(66)}\n`);
process.exit(failures > 0 ? 1 : 0);
