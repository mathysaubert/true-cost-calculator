// ── Moteur de calcul — source unique ────────────────────────────────────────
// Code PUR (aucun import React / Shopify / Supabase / Sentry) pour être :
//   1. importé par app/routes/app._index.jsx (UI + loader + action)
//   2. importé tel quel par les tests Node (tests/*.mjs)
// Toute formule de marge / douane / TVA vit ICI et nulle part ailleurs.

// ── Constantes réglementaires ────────────────────────────────────────────────
// Plafond "faible valeur" qui qualifie un colis pour le régime simplifié dropshipping
// (ex-seuil de minimis Règlement UE n° 952/2013, requalifié par la réforme 2026).
// Au-dessus de ce seuil, même en dropshipping, le tarif % plein s'applique.
export const LOW_VALUE_PARCEL_CEILING = 150;
// Réforme UE : fin de l'exonération douane pour les colis directs au consommateur.
// Règlement approuvé Conseil UE 11/02/2026, effet 01/07/2026.
export const EU_DROPSHIP_DUTY_REFORM_DATE = new Date("2026-07-01T00:00:00Z");
// Forfait intérimaire (jusqu'en 2028) : 3€ par position tarifaire par colis.
// ⚠️ Ce montant changera en 2028 → modifier UNIQUEMENT ici.
export const EU_DROPSHIP_FLAT_DUTY = 3;

export const PAYMENT_PROCESSORS = [
  { id: "Stripe EU",               rate: 1.5,  fixedFee: 0.25, hint: "Cartes EU — 1,5% + 0,25€/transaction" },
  { id: "Stripe non-EU",           rate: 2.5,  fixedFee: 0.25, hint: "Cartes non-EU — 2,5% + 0,25€/transaction" },
  { id: "Shopify Payments Basic",  rate: 2.0,  fixedFee: 0.25, hint: "Plan Basic — 2% + 0,25€/transaction" },
  { id: "Shopify Payments Avancé", rate: 1.0,  fixedFee: 0.25, hint: "Plan Avancé — 1% + 0,25€/transaction" },
  { id: "Shopify Payments Plus",   rate: 0.5,  fixedFee: 0.25, hint: "Plan Plus — 0,5% + 0,25€/transaction" },
];

export const CUSTOMS_RATES = {
  Textile: 0.12, Électronique: 0.05, Cosmétique: 0.10,
  Accessoires: 0.07, Sport: 0.05, Alimentation: 0.15,
  Maroquinerie: 0.03, Jouets: 0, Mobilier: 0.027, Livres: 0, Autre: 0.03,
};
export const SHIPPING_ESTIMATES = { Chine: 8, Inde: 6, Turquie: 4, UE: 2, Autre: 5 };

// Taux de TVA français par catégorie produit — identique à l'import et à la vente domestique
// (la catégorie NC/TARIC détermine le taux, pas le type de transaction).
// Taux réduit 5,5 % : Alimentation (art. 278-0 bis CGI), Livres (art. 278-0 bis A CGI).
export const VAT_RATES = {
  Alimentation: 0.055, Livres: 0.055,
  Textile: 0.20, Électronique: 0.20, Cosmétique: 0.20,
  Accessoires: 0.20, Sport: 0.20,
  Maroquinerie: 0.20, Jouets: 0.20, Mobilier: 0.20, Autre: 0.20,
};
export function getVatRate(category) {
  return VAT_RATES[category] ?? 0.20;
}

// ── Helpers de formatage (purs, FR) ──────────────────────────────────────────
export const safeNum = (n) => (Number.isFinite(n) ? n : 0);
export const formatEur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNum(n));
export const formatPct = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(safeNum(n));
export const formatNum = (n) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeNum(n));

// ── Douane ────────────────────────────────────────────────────────────────────
// shippingModel="dropshipping" : colis direct fournisseur → client final.
//   - colis faible valeur (≤ LOW_VALUE_PARCEL_CEILING) : 0€ avant le 01/07/2026,
//     forfait EU_DROPSHIP_FLAT_DUTY (3€) à partir du 01/07/2026.
//   - colis haute valeur (> ceiling) : tarif % plein sur CIF.
// shippingModel="stock" : import commercial en lot, tarif % plein sur CIF, pas de seuil.
// `now` injectable pour tester le chemin post-réforme avant le 1er juillet.
export function getCustomsDuty({ supplierPrice, shippingCost, dutyRate, shippingModel = "stock", now = new Date() }) {
  if (shippingModel === "dropshipping") {
    if (supplierPrice > LOW_VALUE_PARCEL_CEILING) {
      return (supplierPrice + shippingCost) * dutyRate; // haute valeur : tarif plein
    }
    return now >= EU_DROPSHIP_DUTY_REFORM_DATE ? EU_DROPSHIP_FLAT_DUTY : 0;
  }
  // Import en stock : tarif plein sur CIF, aucun seuil.
  return (supplierPrice + shippingCost) * dutyRate;
}

// ── Coût rendu (CIF) ──────────────────────────────────────────────────────────
// vatRegime "assujetti" → TVA import récupérable, exclue du coût net.
// vatRegime "franchise" → TVA import coût sec, incluse dans le coût rendu.
// shippingModel "dropshipping" → qty forcé à 1 (chaque client = 1 colis, fret non divisible).
// shippingModel "stock"       → qty divise le fret de lot entre les unités.
export function computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime = "assujetti", shippingModel = "stock", qty = 1, now = new Date()) {
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

// ── Marge — FONCTION CANONIQUE UNIQUE ────────────────────────────────────────
// Dashboard, audit et calcNetMargin passent TOUS par ici. Taux en POURCENTS.
// `shipping` explicite (audit, flat) prioritaire ; sinon dérivé de SHIPPING_ESTIMATES[paysImport].
// Assujetti + TTC : revenu net = HT (TVA collectée reversée). Shopify/Stripe restent sur TTC.
export function computeMargin({
  prixAchat, prixVente,
  categorie, paysImport, shipping,
  shopifyFee = 0, stripeFee = 0, processorFixedFee = 0,
  retours = 0, ads = 0, fraisRetour = 0, coutEmballage = 0,
  vatRegime = "assujetti", shopTaxesIncluded = true,
  shippingModel = "stock", qty = 1, now = new Date(),
}) {
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shippingResolved = (shipping != null) ? shipping : (SHIPPING_ESTIMATES[paysImport] ?? 5);
  const { droitsDouane, tvaImport, tvaNetCost, coutRendu } =
    computeLandedCost(prixAchat, shippingResolved, customsRate, vatRate, vatRegime, shippingModel, qty, now);
  // Assujetti + prix TTC → revenu net HT. Franchise / non-TTC → prix déjà net.
  const revenu       = (vatRegime === "assujetti" && shopTaxesIncluded) ? prixVente / (1 + vatRate) : prixVente;
  const shopifyCost  = prixVente * (shopifyFee / 100);                    // TTC : base contractuelle
  const stripeCost   = (prixVente * (stripeFee / 100)) + processorFixedFee; // TTC : base contractuelle
  const retoursCost  = revenu * (retours / 100);                          // HT : un retour = une vente HT perdue
  const adsCost      = prixVente * (ads / 100);                           // TTC : dépense sur CA brut
  const fraisFixes   = fraisRetour + coutEmballage;
  const totalFraisVente = shopifyCost + stripeCost + retoursCost + adsCost;
  const margeBrute   = revenu - coutRendu;
  const margeNette   = margeBrute - totalFraisVente - fraisFixes;
  const margeBrutePercent = prixVente > 0 ? (margeBrute / prixVente) * 100 : 0;
  const margeNettePercent = prixVente > 0 ? (margeNette / prixVente) * 100 : 0;
  const margeApparente    = prixVente > 0 ? ((prixVente - prixAchat) / prixVente) * 100 : 0;
  return {
    customsRate, vatRate, shipping: shippingResolved,
    douane: droitsDouane, tvaImport, tvaNetCost, coutRendu,
    revenu, shopifyCost, stripeCost, retoursCost, adsCost, fraisFixes, totalFraisVente,
    margeBrute, margeBrutePercent, margeNette, margeNettePercent, margeApparente,
    rentable: margeNette > 0,
  };
}

// Vue restreinte pour computeScenarios (back-compat). Délègue à computeMargin.
export function calcNetMargin(prixAchat, prixVente, categorie, paysImport, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, vatRegime, shopTaxesIncluded = true, shippingModel = "stock") {
  const m = computeMargin({
    prixAchat, prixVente, categorie, paysImport,
    shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage,
    vatRegime, shopTaxesIncluded, shippingModel,
  });
  return { margeNette: m.margeNette, margeNettePercent: m.margeNettePercent, coutRendu: m.coutRendu, rentable: m.rentable };
}

// Feature 3 : résout le prix de vente pour une marge nette cible (solveur inverse).
export function simulateSellingPrice(prixAchat, categorie, paysImport, targetMarginPct, fees) {
  const { shopifyFee, stripeFee, retours, ads, fraisRetour = 0, coutEmballage = 0, processorFixedFee = 0, vatRegime = "assujetti", shippingModel = "stock" } = fees;
  const customsRate = CUSTOMS_RATES[categorie] ?? 0.03;
  const vatRate     = getVatRate(categorie);
  const shipping    = SHIPPING_ESTIMATES[paysImport] ?? 5;
  const { coutRendu } = computeLandedCost(prixAchat, shipping, customsRate, vatRate, vatRegime, shippingModel);
  const fraisFixes  = fraisRetour + coutEmballage + processorFixedFee;
  const totalFeeRate = (shopifyFee + stripeFee + retours + ads) / 100;
  const denominator = 1 - totalFeeRate - targetMarginPct / 100;
  if (denominator <= 0) return null;
  return { prixVenteMin: (coutRendu + fraisFixes) / denominator, coutRendu, fraisFixes, totalFeeRate, customsRate, shipping };
}

// Génère les scénarios pré-calculés pour l'IA. Tous les chiffres viennent du moteur.
export function computeScenarios({ prixAchat, prixVente, categorie, paysImport, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, vatRegime, shopTaxesIncluded = true, shippingModel = "stock" }) {
  const run = (o = {}) => {
    const p = { prixAchat, prixVente, shopifyFee, stripeFee, processorFixedFee, retours, ads, fraisRetour, coutEmballage, ...o };
    return calcNetMargin(p.prixAchat, p.prixVente, categorie, paysImport, p.shopifyFee, p.stripeFee, p.processorFixedFee, p.retours, p.ads, p.fraisRetour, p.coutEmballage, vatRegime, shopTaxesIncluded, shippingModel);
  };

  const current = run();
  const list = [];

  if (coutEmballage > 1.50) {
    list.push({ id: "emb_150", levier: `Emballage réduit à 1,50 € (−${formatEur(coutEmballage - 1.50)}/vente)`, ...run({ coutEmballage: 1.50 }) });
  }
  if (coutEmballage > 3.00) {
    list.push({ id: "emb_300", levier: `Emballage réduit au seuil 3,00 € (−${formatEur(coutEmballage - 3.00)}/vente)`, ...run({ coutEmballage: 3.00 }) });
  }
  const pa80 = parseFloat((prixAchat * 0.80).toFixed(2));
  list.push({ id: "fourn_80", levier: `Fournisseur renégocié −20 % → ${formatEur(pa80)}`, ...run({ prixAchat: pa80 }) });
  const pa70 = parseFloat((prixAchat * 0.70).toFixed(2));
  list.push({ id: "fourn_70", levier: `Fournisseur renégocié −30 % → ${formatEur(pa70)}`, ...run({ prixAchat: pa70 }) });
  const pv125 = parseFloat((prixVente * 1.25).toFixed(2));
  list.push({ id: "pv_125", levier: `Prix de vente +25 % → ${formatEur(pv125)}`, ...run({ prixVente: pv125 }) });
  const pv150 = parseFloat((prixVente * 1.50).toFixed(2));
  list.push({ id: "pv_150", levier: `Prix de vente +50 % → ${formatEur(pv150)}`, ...run({ prixVente: pv150 }) });
  if (ads > 0) {
    list.push({ id: "ads_0", levier: `Budget ads suspendu (${formatPct(ads)} % → 0 %)`, ...run({ ads: 0 }) });
  }
  const seuilSim = simulateSellingPrice(prixAchat, categorie, paysImport, 0, { shopifyFee, stripeFee, retours, ads, fraisRetour, coutEmballage, processorFixedFee, vatRegime, shippingModel });
  if (seuilSim && seuilSim.prixVenteMin > 0) {
    list.push({ id: "pv_seuil", levier: `Prix seuil rentabilité (marge nette = 0,00 €)`, prixCible: seuilSim.prixVenteMin, margeNette: 0, margeNettePercent: 0, rentable: false });
  }
  if (coutEmballage > 1.50) {
    list.push({ id: "combo_emb_pv125", levier: `Combo : emballage 1,50 € + prix +25 % (${formatEur(pv125)})`, ...run({ coutEmballage: 1.50, prixVente: pv125 }) });
  }
  if (current.margeNette < 0 && coutEmballage > 1.50) {
    const seuilCombo = simulateSellingPrice(prixAchat, categorie, paysImport, 0, { shopifyFee, stripeFee, retours, ads, fraisRetour, coutEmballage: 1.50, processorFixedFee, vatRegime, shippingModel });
    if (seuilCombo && seuilCombo.prixVenteMin > 0) {
      list.push({ id: "combo_emb_seuil", levier: `Combo seuil : emballage 1,50 € + prix minimum → ${formatEur(seuilCombo.prixVenteMin)}`, prixCible: seuilCombo.prixVenteMin, margeNette: 0, margeNettePercent: 0, rentable: false });
    }
  }
  return { current, scenarios: list };
}
