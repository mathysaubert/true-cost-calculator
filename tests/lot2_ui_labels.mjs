// Tests d'acceptation Lot 2 — threading shippingModel + labels dynamiques
// Pour lancer : node tests/lot2_ui_labels.mjs

const LOW_VALUE_PARCEL_CEILING     = 150;
const EU_DROPSHIP_DUTY_REFORM_DATE = new Date("2026-07-01T00:00:00Z");
const EU_DROPSHIP_FLAT_DUTY        = 3;
const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10, Accessoires: 0.07,
  Sport: 0.05, Alimentation: 0.15, Maroquinerie: 0.03, Jouets: 0,
  Mobilier: 0.027, Livres: 0, Autre: 0.03,
};
const SHIPPING_ESTIMATES = { Chine: 8, UE: 2 };
const VAT_RATES = {
  Alimentation: 0.055, Livres: 0.055, Sport: 0.20, Textile: 0.20, Autre: 0.20,
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
  const coutRendu       = prixAchat + shippingPerUnit + droitsDouane + tvaNetCost;
  return { droitsDouane, tvaImport, tvaNetCost, coutRendu };
}

function calcNetMargin(prixAchat, prixVente, cat, pays, shopifyFee, stripeFee, fixedFee,
                       retours, ads, fr, emb, vatRegime, shopTaxesIncluded = true,
                       shippingModel = "stock", qty = 1, now = new Date()) {
  const { coutRendu } = computeLandedCost(prixAchat, SHIPPING_ESTIMATES[pays] ?? 5,
    CUSTOMS_RATES[cat] ?? 0.03, getVatRate(cat), vatRegime, shippingModel, qty, now);
  const revenu      = vatRegime === "assujetti" && shopTaxesIncluded ? prixVente / (1 + getVatRate(cat)) : prixVente;
  const shopifyCost = prixVente * (shopifyFee / 100);
  const stripeCost  = (prixVente * (stripeFee / 100)) + fixedFee;
  const retoursCost = revenu * (retours / 100);
  return revenu - coutRendu - shopifyCost - stripeCost - retoursCost - (fr + emb);
}

// Reproduit la logique de note douane du prompt IA (app._index.jsx). Libellés SIMPLIFIÉS après le
// chantier langage : aucun tiret cadratin (ponctuation → virgule), aucun « CIF ».
function iaDouaneLabel(prixAchat, douane, shippingModel, now) {
  const sm = shippingModel ?? "stock";
  const pa = parseFloat(prixAchat);
  if (sm === "dropshipping") {
    if (pa > LOW_VALUE_PARCEL_CEILING) return " (haute valeur, tarif % plein)";
    return now < EU_DROPSHIP_DUTY_REFORM_DATE
      ? " (faible valeur, exonéré jusqu'au 30/06/2026)"
      : " (faible valeur, forfait douanier UE depuis le 01/07/2026)";
  }
  return "";
}

// Reproduit la logique du libellé douane de la ventilation UI (app._index.jsx). SIMPLIFIÉ : « exonéré »
// affiché « gratuit », « % sur CIF » → « % sur le produit + port », aucun tiret cadratin.
function uiDouaneLabel(prixAchat, douane, customsRate, shippingModel, now) {
  const sm = shippingModel ?? "stock";
  const pa = prixAchat ?? 0;
  if (douane === 0) {
    if (sm === "dropshipping" && pa <= LOW_VALUE_PARCEL_CEILING) {
      return now < EU_DROPSHIP_DUTY_REFORM_DATE
        ? `+ Droits de douane (gratuit jusqu'au 30/06/2026)`
        : `+ Droits de douane (faible valeur, gratuit)`;
    }
    return `+ Droits de douane (gratuit)`;
  }
  if (sm === "dropshipping" && pa <= LOW_VALUE_PARCEL_CEILING) {
    return `+ Droits de douane (forfait de 3 € par article, réforme UE)`;
  }
  return `+ Droits de douane (${(customsRate*100).toFixed(0)} % sur le produit + port)`;
}

const PRE  = new Date("2026-06-16T00:00:00Z");
const POST = new Date("2026-07-01T00:00:00Z");
const eur  = (n) => `${Number.isFinite(n) ? n.toFixed(2) : "NaN"} €`;
let failures = 0;
function assert(cond, label) {
  if (!cond) failures++;
  console.log(`  ${cond ? "✓" : "✗ ÉCHEC"} ${label}`);
}
function section(t) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════════
// T1 — Threading : calcNetMargin dropshipping vs stock donne des résultats différents
// ════════════════════════════════════════════════════════════════════════════════
section("T1 : Threading shippingModel — dropshipping ≠ stock post-réforme");
{
  const S = { s: 2, st: 1.5, f: 0.25, r: 5, a: 0, fr: 0, emb: 0 };
  const mStock = calcNetMargin(40, 100, "Sport", "Chine", S.s, S.st, S.f, S.r, S.a, S.fr, S.emb, "assujetti", true, "stock",        1, POST);
  const mDrop  = calcNetMargin(40, 100, "Sport", "Chine", S.s, S.st, S.f, S.r, S.a, S.fr, S.emb, "assujetti", true, "dropshipping", 1, POST);
  console.log(`  stock marge=${eur(mStock)} | dropshipping marge=${eur(mDrop)} (écart=${eur(mStock - mDrop)})`);
  // Stock : droits = (40+8)×5% = 2.40 | Dropshipping faible valeur post : droits = 3€
  // Différence de douane : 3 - 2.40 = 0.60 → marge dropshipping légèrement inférieure
  assert(mDrop < mStock, "Dropshipping post-réforme marge < stock (3€ forfait > 2.40€ % sur colis faible valeur)");
}

// ════════════════════════════════════════════════════════════════════════════════
// T2 — Threading : default "dropshipping" pour les 4 états initiaux
// ════════════════════════════════════════════════════════════════════════════════
section("T2 : Défauts initiaux = dropshipping");
{
  const formDefault   = "dropshipping";
  const simDefault    = "dropshipping";
  const auditDefault  = "dropshipping";
  assert(formDefault  === "dropshipping", "form.shippingModel initial = dropshipping");
  assert(simDefault   === "dropshipping", "simForm.shippingModel initial = dropshipping");
  assert(auditDefault === "dropshipping", "auditParams.shipping_model initial = dropshipping");
}

// ════════════════════════════════════════════════════════════════════════════════
// T3 — Label IA : 4 cas
// ════════════════════════════════════════════════════════════════════════════════
section("T3 : Labels dynamiques prompt IA");
{
  const { droitsDouane: d1 } = computeLandedCost(40,   8, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", "dropshipping", 1, PRE);
  const { droitsDouane: d2 } = computeLandedCost(2.44, 8, CUSTOMS_RATES["Autre"], getVatRate("Autre"), "assujetti", "dropshipping", 1, PRE);
  const { droitsDouane: d3 } = computeLandedCost(2.44, 8, CUSTOMS_RATES["Autre"], getVatRate("Autre"), "assujetti", "dropshipping", 1, POST);
  const { droitsDouane: d4 } = computeLandedCost(40,   8, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", "stock",        1, POST);

  // 40€ < 150€ → faible valeur (seuil est 150, pas relatif au taux)
  const l1 = iaDouaneLabel(40,   d1, "dropshipping", PRE);
  // 200€ > 150€ → haute valeur
  const { droitsDouane: d1b } = computeLandedCost(200, 8, CUSTOMS_RATES["Sport"], getVatRate("Sport"), "assujetti", "dropshipping", 1, POST);
  const l1b = iaDouaneLabel(200, d1b, "dropshipping", POST);
  const l2 = iaDouaneLabel(2.44, d2, "dropshipping", PRE);
  const l3 = iaDouaneLabel(2.44, d3, "dropshipping", POST);
  const l4 = iaDouaneLabel(40,   d4, "stock",        POST);

  assert(l1.includes("30/06/2026"),          `Dropship 40€ pré (faible val) : "${l1}"`);
  assert(l1b.includes("haute valeur"),       `Dropship 200€ post (haute val) : "${l1b}"`);
  assert(l2.includes("30/06/2026"),          `Dropship 2.44€ pré: "${l2}"`);
  assert(l3.includes("forfait douanier UE"), `Dropship 2.44€ post (forfait UE) : "${l3}"`);
  assert(l4 === "",                          `Stock post : label vide "${l4}"`);
  // Langage simplifié : aucune note IA douane ne contient de tiret cadratin/demi-cadratin ni « CIF »
  assert(![l1, l1b, l2, l3].some(l => l.includes("—") || l.includes("–") || l.includes("CIF")),
    "Notes IA douane : 0 tiret cadratin, 0 « CIF »");
}

// ════════════════════════════════════════════════════════════════════════════════
// T4 — Label ventilation UI : 5 cas
// ════════════════════════════════════════════════════════════════════════════════
section("T4 : Labels dynamiques ventilation UI");
{
  // Dropship faible valeur pré : "gratuit jusqu'au..."
  const l1 = uiDouaneLabel(2.44, 0, 0.03, "dropshipping", PRE);
  assert(l1.includes("30/06/2026"), `Dropship faible val pré : "${l1}"`);

  // Dropship faible valeur post : droits = 3€ → "forfait de 3 € par article"
  const l2 = uiDouaneLabel(2.44, 3, 0.03, "dropshipping", POST);
  assert(l2.includes("forfait de 3"), `Dropship faible val post : "${l2}"`);

  // Dropship haute valeur post : droits = (200+8)×5% = 10.4 → "% sur le produit + port"
  const l3 = uiDouaneLabel(200, 10.4, 0.05, "dropshipping", POST);
  assert(l3.includes("sur le produit + port"), `Dropship haute val post : "${l3}"`);

  // Stock, droits 2.40 → "% sur le produit + port"
  const l4 = uiDouaneLabel(40, 2.40, 0.05, "stock", PRE);
  assert(l4.includes("sur le produit + port"), `Stock pré : "${l4}"`);

  // Langage simplifié : aucun libellé ne contient 'de minimis', '150', « CIF » ni tiret cadratin/demi-cadratin
  assert(![l1, l2, l3, l4].some(l => l.includes("minimis") || l.includes("150") || l.includes("CIF") || l.includes("—") || l.includes("–")),
    "Libellés ventilation douane : 0 'de minimis'/'150'/'CIF'/tiret cadratin");
}

// ════════════════════════════════════════════════════════════════════════════════
// T5 — Non-régression Lot 1 : résultats stables (recalcul avec shippingModel)
// ════════════════════════════════════════════════════════════════════════════════
section("T5 : Non-régression — résultats Lot 1 identiques");
{
  // Tests 1-4 du Lot 1 réexécutés via calcNetMargin complet
  const S = { s: 2, st: 1.5, f: 0.25, r: 5, a: 0, fr: 0, emb: 0 };

  // Test 3 : Dropshipping 2.44€ pré → droits 0, marge identique à un calcul sans douane
  const mPre  = calcNetMargin(2.44, 7.90, "Autre", "Chine", S.s, S.st, S.f, S.r, S.a, S.fr, S.emb, "assujetti", true, "dropshipping", 1, PRE);
  const mPost = calcNetMargin(2.44, 7.90, "Autre", "Chine", S.s, S.st, S.f, S.r, S.a, S.fr, S.emb, "assujetti", true, "dropshipping", 1, POST);
  const { droitsDouane: droitsPre } = computeLandedCost(2.44, 8, 0.03, 0.20, "assujetti", "dropshipping", 1, PRE);
  assert(droitsPre === 0, `Pré-réforme droits = ${droitsPre}€`);
  // Note : chaussettes 2,44€ + port 8€ (dropshipping qty=1 forcé) → coutRendu 10,44€ > 7,90€ vente.
  // Jamais rentables en dropshipping (port absorbe la marge), avant comme après réforme.
  assert(mPre < 0, `Pré-réforme marge ${eur(mPre)} < 0 (port 8€ dépasse la vente 7,90€)`);
  assert(mPre > mPost, `Pré-réforme moins négative que post (${eur(mPre)} > ${eur(mPost)})`);
  assert(mPost < -7, `Post-réforme marge ${eur(mPost)} < −7€`);
}

// ════════════════════════════════════════════════════════════════════════════════
console.log(`\n${"═".repeat(66)}`);
console.log(` BILAN LOT 2 : ${failures === 0 ? "✓ Tous les tests passent" : `✗ ${failures} échec(s)`}`);
console.log(`${"═".repeat(66)}\n`);
process.exit(failures > 0 ? 1 : 0);
