// ── Économie d'UNE ligne de commande — PUR, appelé par l'ingestion (F2) ───────────────────────
// Produit le SNAPSHOT figé d'une ligne : prix HT depuis les lignes de taxe (jamais par hypothèse
// de taux — brief §9), coût produit rendu (UE via engine.js, hors UE via la formule générique de
// la décision 7/A9, ou le coût rendu saisi), composantes CM1, unités comptées (A2).
// engine.js n'est JAMAIS modifié : on n'importe que computeLandedCost et CUSTOMS_RATES.
import { computeLandedCost, CUSTOMS_RATES } from "../engine.js";
import { isEuCountry, vatRateFor } from "./vat.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const intPos = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };

// ── Prix unitaire HT et TTC depuis les lignes de taxe Shopify ─────────────────────────────────
// unitPrice = prix unitaire APRÈS remises (D1 : discountedUnitPriceAfterAllDiscounts, shopMoney).
// taxLines = lignes de taxe de la LIGNE (montants pour toutes les unités). taxesIncluded (Order) dit
// si unitPrice contient la taxe. Aucune hypothèse de taux : on soustrait/ajoute ce que Shopify dit.
export function unitPrices({ unitPrice, quantity, taxLines = [], taxesIncluded = true }) {
  const qty = intPos(quantity, 1);
  const taxTotal = (taxLines ?? []).reduce((s, t) => s + num(t?.amount), 0);
  const taxPerUnit = taxTotal / qty;
  const p = num(unitPrice);
  return taxesIncluded
    ? { unit_price_ttc: p, unit_price_ht: p - taxPerUnit, tax_per_unit: taxPerUnit }
    : { unit_price_ttc: p + taxPerUnit, unit_price_ht: p, tax_per_unit: taxPerUnit };
}

// ── Unités comptées (décision A2) ────────────────────────────────────────────────────────────
// revenue_units : unités payées et non remboursées (le remboursement annule la vente).
// cogs_units    : unités dont le coût est réellement supporté = quantité − unités RESTOCKÉES
//                 (restockType RETURN/CANCEL) quand l'info existe ; repli quantité − remboursées.
export function countedUnits({ quantity, refunded_qty = 0, restocked_qty = null }) {
  const q = intPos(quantity, 0);
  const refunded = Math.min(q, intPos(refunded_qty, 0));
  const restocked = restocked_qty == null ? null : Math.min(refunded, intPos(restocked_qty, 0));
  return {
    revenue_units: q - refunded,
    cogs_units: restocked == null ? q - refunded : q - restocked,
    restock_known: restocked != null,
  };
}

// ── Coût produit rendu par unité ─────────────────────────────────────────────────────────────
// costRow = ligne variant_costs (coûts SAISIS) ; shopCountryCode = pays de la boutique (A9).
//   • landed_cost_override saisi → coût rendu = cette valeur (aucune décomposition).
//   • marchand UE → engine.computeLandedCost (TARIC, forfait dropshipping, TVA import au taux du
//     pays du marchand — A8) ; tva_import_non_recup = TVA non récupérable (régime franchise).
//   • hors UE → droits = (achat + port unitaire) × duty_rate_pct ; pas de TVA d'import (A9).
// Emballage : PAS ici (CM2, par commande — A4). port_entrant/qty_par_lot : port ENTRANT fournisseur.
export function landedCostUnit({ costRow, shopCountryCode, now = new Date() }) {
  const c = costRow ?? {};
  if (c.landed_cost_override != null && Number.isFinite(+c.landed_cost_override)) {
    const v = num(c.landed_cost_override);
    return { coutRendu: v, components: { achat: v, port_entrant: 0, droits: 0, tva_import_non_recup: 0 }, method: "override" };
  }
  const prixAchat = num(c.prix_achat);
  const port = num(c.port_entrant);
  const qty = intPos(c.qty_par_lot, 1);
  const model = c.shipping_model === "dropshipping" ? "dropshipping" : "stock";
  const portUnit = port / (model === "dropshipping" ? 1 : qty);
  if (isEuCountry(shopCountryCode)) {
    const customsRate = CUSTOMS_RATES[c.categorie] ?? 0.03;
    const vatRate = vatRateFor({ countryCode: shopCountryCode, categorie: c.categorie }) ?? 0;
    const r = computeLandedCost(prixAchat, port, customsRate, vatRate, c.vat_regime ?? "assujetti", model, qty, now);
    return {
      coutRendu: r.coutRendu,
      components: { achat: prixAchat, port_entrant: portUnit, droits: r.droitsDouane, tva_import_non_recup: r.tvaNetCost },
      method: "eu_taric", customsRate, vatRate, tvaImport: r.tvaImport,
    };
  }
  const droits = (prixAchat + portUnit) * (num(c.duty_rate_pct) / 100);
  return {
    coutRendu: prixAchat + portUnit + droits,
    components: { achat: prixAchat, port_entrant: portUnit, droits, tva_import_non_recup: 0 },
    method: "generic_duty",
  };
}

// ── Snapshot complet d'une ligne ─────────────────────────────────────────────────────────────
// line  : { line_item_id, product_id, variant_id, quantity, refunded_qty, restocked_qty,
//           unit_price (après remises), unit_price_original (avant remises, optionnel),
//           tax_lines, is_gift_card }
// order : { taxes_included }
// Retour figé à l'ingestion (jamais recalculé) ; cost_source 'missing' ⇒ CM1 null (jamais 0).
export function computeLineEconomics({ line, order, costRow, settings = {}, now = new Date() }) {
  const l = line ?? {};
  const qty = intPos(l.quantity, 0);
  const prices = unitPrices({ unitPrice: l.unit_price, quantity: qty || 1, taxLines: l.tax_lines, taxesIncluded: order?.taxes_included !== false });
  const original = l.unit_price_original != null
    ? unitPrices({ unitPrice: l.unit_price_original, quantity: qty || 1, taxLines: l.tax_lines, taxesIncluded: order?.taxes_included !== false })
    : null;
  const units = countedUnits({ quantity: qty, refunded_qty: l.refunded_qty, restocked_qty: l.restocked_qty });
  const isGift = l.is_gift_card === true;
  const base = {
    line_item_id: l.line_item_id ?? null, product_id: l.product_id ?? null, variant_id: l.variant_id ?? null,
    quantity: qty, refunded_qty: Math.min(qty, intPos(l.refunded_qty, 0)), restocked_qty: l.restocked_qty == null ? null : intPos(l.restocked_qty, 0),
    revenue_units: units.revenue_units, cogs_units: units.cogs_units, restock_known: units.restock_known,
    unit_price_ttc: prices.unit_price_ttc, unit_price_ht: prices.unit_price_ht, tax_per_unit: prices.tax_per_unit,
    unit_price_original_ht: original ? original.unit_price_ht : null,
    tax_lines: l.tax_lines ?? [], is_gift_card: isGift,
    packaging_override_unit: costRow?.cout_emballage != null && num(costRow.cout_emballage) > 0 ? num(costRow.cout_emballage) : null,
  };
  if (isGift || !costRow) {
    return { ...base, cost_source: isGift ? "excluded" : "missing", customs_estimated: false, cm1_components: null, cm1_unit: null, cout_rendu_unit: null };
  }
  const lc = landedCostUnit({ costRow, shopCountryCode: settings.shop_country_code, now });
  return {
    ...base,
    cost_source: costRow.source ?? "estimated",
    customs_estimated: costRow.customs_confirmed !== true,
    cm1_components: lc.components,
    cout_rendu_unit: lc.coutRendu,
    cm1_unit: prices.unit_price_ht - lc.coutRendu,
    landed_method: lc.method,
  };
}
