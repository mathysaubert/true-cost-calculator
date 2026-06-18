// ════════════════════════════════════════════════════════════════════════════════
//  GARDE-FOU BOUT-EN-BOUT — invariants cross-lot
//  Importe le VRAI moteur (app/lib/engine.js), pas une réimplémentation.
//  Objectif : attraper une dérive comme le 27,41€ → 25,02€ silencieux du Lot 1→2,
//  où les tests par lot passaient en isolation mais rien ne vérifiait l'ensemble.
//
//  Couverture des "modules" :
//   - computeMargin     : fonction canonique (importée, testée directement)
//   - calcNetMargin     : wrapper sur computeMargin (importé) → chemin computeScenarios/IA
//   - computeScenarios  : .current = calcNetMargin (importé)
//   - dashboard calculate & audit run_audit : dans app._index.jsx ils n'ont PLUS
//     d'arithmétique propre — ils appellent computeMargin (vérifié dans le source).
//     On rejoue ici leur adaptateur d'arguments exact (audit: taux décimaux ×100,
//     shipping explicite) pour verrouiller le mapping, sans dupliquer la formule.
// ════════════════════════════════════════════════════════════════════════════════

import {
  computeMargin, calcNetMargin, computeScenarios, computeLandedCost, getCustomsDuty,
  CUSTOMS_RATES, SHIPPING_ESTIMATES, getVatRate,
  LOW_VALUE_PARCEL_CEILING, EU_DROPSHIP_DUTY_REFORM_DATE, EU_DROPSHIP_FLAT_DUTY,
} from "../app/lib/engine.js";

// ⚠️ Ancres : à mettre à jour seulement si une règle métier change volontairement.
//    Si elles cassent sans changement voulu = régression.
const ANCHORS = {
  // Stock, assujetti, taxesIncluded, Sport, Chine, 40→100, Stripe EU, Shopify 2%, retours 5%
  stockAssujetti:   25.02,
  // Idem, franchise
  stockFranchise:   30.77,
  // Dropshipping, assujetti, 2,44→7,90, post-réforme (douane forfait 3€)
  dropshipPost:     -7.71,
  // Cas écran : 13,99→49,99, Textile 12%, emballage 12,60, stock, assujetti, retours 0, port Chine
  ecranMarge:       2.43,
  ecranCpa:         2.43,
  ecranRoas:        20.6,
};

const PRE  = new Date("2026-06-16T00:00:00Z"); // avant réforme
const POST = new Date("2026-07-01T00:00:00Z"); // réforme active

// ── Harnais ───────────────────────────────────────────────────────────────────
let failures = 0, passes = 0;
const eur = (n) => `${Number.isFinite(n) ? n.toFixed(4) : String(n)} €`;
function assert(cond, label) {
  if (cond) { passes++; console.log(`  ✓ ${label}`); }
  else { failures++; console.log(`  ✗ ÉCHEC ${label}`); }
}
function section(t) { console.log(`\n── ${t} ──`); }

// Échantillon : 2 régimes TVA × 2 modèles × catégories représentatives
const REGIMES = ["assujetti", "franchise"];
const MODELS  = ["stock", "dropshipping"];
const CATS    = ["Sport", "Alimentation", "Autre", "Textile"];
const baseParams = (over = {}) => ({
  prixAchat: 40, prixVente: 100, categorie: "Sport", paysImport: "Chine",
  shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25,
  retours: 5, ads: 0, fraisRetour: 0, coutEmballage: 3,
  vatRegime: "assujetti", shopTaxesIncluded: true, shippingModel: "stock",
  ...over,
});

// Adaptateur AUDIT (réplique le mapping de app._index.jsx, PAS la formule) :
// taux décimaux ×100, shipping explicite = SHIPPING_ESTIMATES[pays] pour comparer au dashboard.
function auditMargin(p) {
  const m = computeMargin({
    prixAchat: p.prixAchat, prixVente: p.prixVente,
    categorie: p.categorie, shipping: SHIPPING_ESTIMATES[p.paysImport] ?? 5,
    shopifyFee: (p.shopifyFee / 100) * 100,   // dashboard percent → audit decimal → ×100 (identité ici)
    stripeFee: (p.stripeFee / 100) * 100,
    processorFixedFee: p.processorFixedFee,
    retours: (p.retours / 100) * 100,
    ads: 0, fraisRetour: 0, coutEmballage: 0,  // audit n'a ni ads ni frais fixes
    vatRegime: p.vatRegime, shopTaxesIncluded: p.shopTaxesIncluded,
    shippingModel: p.shippingModel, qty: 1, now: p.now,
  });
  return m;
}

// ════════════════════════════════════════════════════════════════════════════════
// A1 — COHÉRENCE INTER-MODULES (l'invariant central)
// computeMargin == calcNetMargin == computeScenarios.current, au centième,
// dans les DEUX ères (now=PRE et now=POST). `now` injecté de bout en bout
// (Tâche 1) → le chemin IA n'est plus aveugle au post-réforme.
// ════════════════════════════════════════════════════════════════════════════════
section("A1 : Cohérence computeMargin = calcNetMargin = computeScenarios.current (PRE + POST)");
for (const [eraLabel, now] of [["PRE", PRE], ["POST", POST]]) {
  for (const vatRegime of REGIMES) {
    for (const shippingModel of MODELS) {
      for (const categorie of CATS) {
        const p = baseParams({ vatRegime, shippingModel, categorie, now });
        const mCanon = computeMargin(p).margeNette;
        const mCalc  = calcNetMargin(
          p.prixAchat, p.prixVente, p.categorie, p.paysImport,
          p.shopifyFee, p.stripeFee, p.processorFixedFee, p.retours, p.ads,
          p.fraisRetour, p.coutEmballage, p.vatRegime, p.shopTaxesIncluded, p.shippingModel, now
        ).margeNette;
        const mScen  = computeScenarios(p).current.margeNette;
        const okCalc = Math.abs(mCanon - mCalc) < 0.01;
        const okScen = Math.abs(mCanon - mScen) < 0.01;
        assert(okCalc && okScen,
          `[${eraLabel}] ${vatRegime}/${shippingModel}/${categorie} : canon=${eur(mCanon)} calc=${eur(mCalc)} scen=${eur(mScen)}`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// A2 — CPA max = marge nette à ads=0 (réconciliation rapatriée du fix CPA)
// CPA max (BreakEvenROAS) = revenu - coutRendu - shopify - stripe - retours - fraisFixes
// ════════════════════════════════════════════════════════════════════════════════
section("A2 : CPA max = marge nette quand ads=0");
for (const vatRegime of REGIMES) {
  for (const shippingModel of MODELS) {
    const p = baseParams({ vatRegime, shippingModel, ads: 0 });
    const m = computeMargin(p);
    const cpaMax = m.revenu - m.coutRendu - m.shopifyCost - m.stripeCost - m.retoursCost - m.fraisFixes;
    assert(Math.abs(cpaMax - m.margeNette) < 0.001,
      `${vatRegime}/${shippingModel} : CPA=${eur(cpaMax)} margeNette=${eur(m.margeNette)}`);
  }
}
// Et à ads>0 : margeNette = CPA − adsCost (le CPA exclut la pub par design)
{
  const p = baseParams({ ads: 10 });
  const m = computeMargin(p);
  const cpaMax = m.revenu - m.coutRendu - m.shopifyCost - m.stripeCost - m.retoursCost - m.fraisFixes;
  assert(Math.abs((cpaMax - m.adsCost) - m.margeNette) < 0.001,
    `ads=10% : margeNette(${eur(m.margeNette)}) = CPA(${eur(cpaMax)}) − adsCost(${eur(m.adsCost)})`);
}

// ════════════════════════════════════════════════════════════════════════════════
// A3 — Sens HT/franchise : assujetti+TTC ampute la TVA collectée → marge < franchise
// (cas à marge saine ; on vérifie le SENS, pas le montant)
// ════════════════════════════════════════════════════════════════════════════════
section("A3 : marge assujetti+TTC < marge franchise (toutes choses égales)");
for (const categorie of CATS) {
  const pA = baseParams({ categorie, vatRegime: "assujetti", shopTaxesIncluded: true });
  const pF = baseParams({ categorie, vatRegime: "franchise" });
  const mA = computeMargin(pA).margeNette;
  const mF = computeMargin(pF).margeNette;
  assert(mA < mF, `${categorie} : assujetti ${eur(mA)} < franchise ${eur(mF)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// A4 — Monotonie réforme : en dropshipping, douane post ≥ douane pré, pour tout produit
// ════════════════════════════════════════════════════════════════════════════════
section("A4 : dropshipping — douane post-réforme ≥ pré-réforme");
for (const categorie of CATS) {
  for (const prixAchat of [2.44, 40, 200]) {  // faible valeur, moyen, haute valeur
    const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
    const dPre  = getCustomsDuty({ supplierPrice: prixAchat, shippingCost: 8, dutyRate: customsRate, shippingModel: "dropshipping", now: PRE });
    const dPost = getCustomsDuty({ supplierPrice: prixAchat, shippingCost: 8, dutyRate: customsRate, shippingModel: "dropshipping", now: POST });
    assert(dPost >= dPre, `${categorie}/${prixAchat}€ : douane pré=${eur(dPre)} → post=${eur(dPost)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// A5 — Monotonie qty : en stock, augmenter qty ne fait jamais monter le coût rendu/unité
// ════════════════════════════════════════════════════════════════════════════════
section("A5 : stock — coût rendu/unité non-croissant en qty");
for (const categorie of CATS) {
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate = getVatRate(categorie);
  const cr = (qty) => computeLandedCost(40, 8, customsRate, vatRate, "assujetti", "stock", qty).coutRendu;
  const c1 = cr(1), c10 = cr(10), c100 = cr(100);
  assert(c1 >= c10 && c10 >= c100, `${categorie} : coutRendu qty 1≥10≥100 = ${eur(c1)} ≥ ${eur(c10)} ≥ ${eur(c100)}`);
}

// ════════════════════════════════════════════════════════════════════════════════
// A6 — Pas de NaN/Infinity : balayage incluant qty=0, qty vide, prix=0
// ════════════════════════════════════════════════════════════════════════════════
section("A6 : aucune sortie NaN/Infinity (cas dégénérés inclus)");
const DEGEN = [
  baseParams({ qty: 0 }),
  baseParams({ qty: "" }),
  baseParams({ qty: "abc" }),
  baseParams({ prixAchat: 0 }),
  baseParams({ prixVente: 0 }),
  baseParams({ prixAchat: 0, prixVente: 0 }),
  baseParams({ shippingModel: "dropshipping", qty: 0, now: POST }),
];
for (let i = 0; i < DEGEN.length; i++) {
  const m = computeMargin(DEGEN[i]);
  const allFinite = [m.coutRendu, m.revenu, m.margeNette, m.margeNettePercent, m.margeBrute, m.douane, m.tvaImport]
    .every(Number.isFinite);
  assert(allFinite, `cas dégénéré #${i + 1} (qty=${JSON.stringify(DEGEN[i].qty)}, pa=${DEGEN[i].prixAchat}, pv=${DEGEN[i].prixVente}) → toutes sorties finies`);
}

// ════════════════════════════════════════════════════════════════════════════════
// B — ANCRES CHIFFRÉES (via le vrai computeMargin)
// ════════════════════════════════════════════════════════════════════════════════
section("B : Ancres chiffrées");
{
  // B1 — stock assujetti 25,02
  const m1 = computeMargin(baseParams({ vatRegime: "assujetti", coutEmballage: 0 }));
  assert(Math.abs(m1.margeNette - ANCHORS.stockAssujetti) < 0.01,
    `B1 stock/assujetti = ${eur(m1.margeNette)} (ancre ${ANCHORS.stockAssujetti})`);

  // B2 — stock franchise 30,77
  const m2 = computeMargin(baseParams({ vatRegime: "franchise", coutEmballage: 0 }));
  assert(Math.abs(m2.margeNette - ANCHORS.stockFranchise) < 0.01,
    `B2 stock/franchise = ${eur(m2.margeNette)} (ancre ${ANCHORS.stockFranchise})`);

  // B3 — dropshipping post-réforme −7,71
  const m3 = computeMargin(baseParams({
    prixAchat: 2.44, prixVente: 7.90, categorie: "Autre",
    shippingModel: "dropshipping", coutEmballage: 0, now: POST,
  }));
  assert(Math.abs(m3.margeNette - ANCHORS.dropshipPost) < 0.01,
    `B3 dropship/post = ${eur(m3.margeNette)} (ancre ${ANCHORS.dropshipPost})`);
  assert(m3.douane === EU_DROPSHIP_FLAT_DUTY, `B3 douane = forfait ${eur(EU_DROPSHIP_FLAT_DUTY)}`);

  // B4 — cas écran : 13,99→49,99 Textile emballage 12,60 stock assujetti retours 0
  const m4 = computeMargin({
    prixAchat: 13.99, prixVente: 49.99, categorie: "Textile", paysImport: "Chine",
    shopifyFee: 2, stripeFee: 1.5, processorFixedFee: 0.25,
    retours: 0, ads: 0, fraisRetour: 0, coutEmballage: 12.60,
    vatRegime: "assujetti", shopTaxesIncluded: true, shippingModel: "stock",
  });
  const cpa4  = m4.revenu - m4.coutRendu - m4.shopifyCost - m4.stripeCost - m4.retoursCost - m4.fraisFixes;
  const roas4 = 49.99 / cpa4;
  console.log(`     coutRendu=${eur(m4.coutRendu)} revenu=${eur(m4.revenu)} shopify=${eur(m4.shopifyCost)} stripe=${eur(m4.stripeCost)}`);
  assert(Math.abs(m4.coutRendu - 24.63) < 0.01, `B4 coutRendu = ${eur(m4.coutRendu)} (attendu 24,63)`);
  assert(Math.abs(m4.margeNette - ANCHORS.ecranMarge) < 0.01, `B4 margeNette = ${eur(m4.margeNette)} (ancre ${ANCHORS.ecranMarge})`);
  assert(Math.abs(cpa4 - ANCHORS.ecranCpa) < 0.01, `B4 CPA max = ${eur(cpa4)} (ancre ${ANCHORS.ecranCpa})`);
  assert(Math.abs(roas4 - ANCHORS.ecranRoas) < 0.1, `B4 ROAS = ${roas4.toFixed(2)}x (ancre ${ANCHORS.ecranRoas}x)`);
}

// ── Vérif transitive dashboard/audit (même computeMargin, adaptateurs distincts) ──
section("Transitif : adaptateur audit == canonique (mêmes intrants logiques)");
for (const vatRegime of REGIMES) {
  for (const shippingModel of MODELS) {
    const p = baseParams({ vatRegime, shippingModel, coutEmballage: 0 });
    const canon = computeMargin(p).margeNette;
    const audit = auditMargin(p).margeNette;
    assert(Math.abs(canon - audit) < 0.01, `${vatRegime}/${shippingModel} : canon=${eur(canon)} audit=${eur(audit)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(66)}`);
console.log(` INVARIANTS : ${failures === 0 ? `✓ ${passes} assertions OK` : `✗ ${failures} échec(s) / ${passes + failures}`}`);
console.log(`${"═".repeat(66)}\n`);
process.exit(failures > 0 ? 1 : 0);
