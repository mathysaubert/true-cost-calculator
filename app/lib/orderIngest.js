// ── Brique B — ingestion commandes : module PUR ─────────────────────────────
// Code PUR (aucun I/O, aucun React/Shopify/Supabase). Importé par la route ET
// par les tests Node. Il prépare l'engineInput, APPELLE computeMargin (jamais ne la
// réécrit), et agrège. AUCUNE formule de marge / TVA / douane / fees ici.
//
// Schéma Shopify confirmé par introspection (2026-04) :
//   Order.refunds: [Refund!]! ; Order.lineItems: connection ;
//   Refund.refundLineItems: connection ; Refund.transactions: connection ;
//   RefundLineItem { lineItem: LineItem!, quantity: Int! } ;
//   OrderTransaction { kind: OrderTransactionKind!, status: OrderTransactionStatus! } ;
//   LineItem.discountedUnitPriceAfterAllDiscountsSet: MoneyBag! (non-null) ;
//   LineItem.variant / product : nullable.
import { computeMargin as _computeMargin } from "./engine.js";

// ── Helpers numériques (parse contrôlé, pas de drift) ────────────────────────
const num    = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const intPos = (v, d = 1) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
// Montant depuis un MoneyBag — shopMoney TOUJOURS, jamais presentmentMoney (D1).
// Retourne null si absent/non-fini (déclenche le fallback D1).
const shopAmount = (moneyBag) => {
  const a = moneyBag?.shopMoney?.amount;
  if (a == null) return null;
  const n = parseFloat(a);
  return Number.isFinite(n) ? n : null;
};

// ── Re-stitch JSONL bulk (impitoyable, ordre des lignes NON garanti) ─────────
// Le bulk aplatit les connexions : chaque enfant arrive en ligne JSONL avec
// __parentId (+ __typename). Deux passes : (1) indexe par id, (2) lie. Ne suppose
// jamais qu'un parent précède son enfant. Stream ligne par ligne, pas de JSON.parse global.
export function parseBulkJsonl(text) {
  const byId = new Map();
  const objs = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    const o = JSON.parse(s);
    objs.push(o);
    if (o.id) byId.set(o.id, o);
  }
  const orders = [];
  for (const o of objs) {
    if (!o.__parentId) {            // racine = Order
      o.lineItems ??= [];
      o.refunds   ??= [];
      orders.push(o);
      continue;
    }
    const parent = byId.get(o.__parentId);
    if (!parent) continue;          // orphelin (ne devrait pas arriver)
    switch (o.__typename) {
      case "LineItem":         (parent.lineItems         ??= []).push(o); o.discountAllocations ??= []; break;
      case "Refund":           (parent.refunds           ??= []).push(o); o.refundLineItems ??= []; o.transactions ??= []; break;
      case "RefundLineItem":   (parent.refundLineItems   ??= []).push(o); break;
      case "OrderTransaction": (parent.transactions      ??= []).push(o); break;
      case "DiscountAllocation":(parent.discountAllocations ??= []).push(o); break;
      default: break;               // type non géré → ignoré
    }
  }
  return orders;
}

// ── D1 : revenu net unitaire (TTC, shopMoney) ───────────────────────────────
// Primaire : discountedUnitPriceAfterAllDiscountsSet (inclut DÉJÀ ligne+order+code).
// Fallback SSI ce champ est null : original − (Σ discountAllocations)/quantity.
// JAMAIS d'ajout de discountAllocations par-dessus le champ AfterAll (double-comptage).
export function netUnitRevenue(line, { onFallback } = {}) {
  const after = shopAmount(line?.discountedUnitPriceAfterAllDiscountsSet);
  if (after != null) return after;
  const orig = shopAmount(line?.originalUnitPriceSet) ?? 0;
  const qty  = intPos(line?.quantity, 1);
  const allocTotal = (line?.discountAllocations ?? []).reduce((s, a) => s + (shopAmount(a?.allocatedAmountSet) ?? 0), 0);
  if (typeof onFallback === "function") onFallback(line);
  return orig - allocTotal / qty;
}

// ── D4 : quantité remboursée EFFECTIVE d'une ligne ──────────────────────────
// Ne compte que les Refund dont ≥1 OrderTransaction a kind=REFUND ET status=SUCCESS.
// Un restock sans remboursement (aucune transaction SUCCESS) → 0 décompté.
export function effectiveRefundedQty(refunds, lineId) {
  let q = 0;
  for (const refund of refunds ?? []) {
    const settled = (refund?.transactions ?? []).some((t) => t?.kind === "REFUND" && t?.status === "SUCCESS");
    if (!settled) continue;
    for (const rli of refund?.refundLineItems ?? []) {
      if (rli?.lineItem?.id === lineId) q += intPos(rli?.quantity, 0);
    }
  }
  return q;
}

// ── Mapping ligne → engineInput (forme exacte de app/_index.jsx:1100) ────────
// processorFixedFee = 0 ici (D3 : fixe imputé PAR COMMANDE au prorata, pas par unité).
// retours=0 (refunds réels via quantité nette), ads=0 (marge avant pub), fraisRetour=0.
// now = order.createdAt (D5 : douane historique).
export function mapLineToEngineInput(line, costRow, shopSettings, orderCreatedAt, { onFallback } = {}) {
  return {
    prixVente:         netUnitRevenue(line, { onFallback }),
    prixAchat:         num(costRow.prix_achat),
    categorie:         costRow.categorie,
    paysImport:        costRow.pays_import,
    shipping:          num(costRow.port_entrant),
    qty:               intPos(costRow.qty_par_lot, 1),
    coutEmballage:     num(costRow.cout_emballage),
    vatRegime:         costRow.vat_regime,
    shippingModel:     costRow.shipping_model,
    shopTaxesIncluded: shopSettings.shopTaxesIncluded !== false,
    shopifyFee:        num(shopSettings.shopifyFee),
    stripeFee:         num(shopSettings.stripeFee),
    processorFixedFee: 0,
    retours:           0,
    ads:               0,
    fraisRetour:       0,
    now:               new Date(orderCreatedAt),
  };
}

const snapshotCosts = (c) => ({
  prix_achat: c.prix_achat, port_entrant: c.port_entrant, qty_par_lot: c.qty_par_lot,
  cout_emballage: c.cout_emballage, vat_regime: c.vat_regime, shipping_model: c.shipping_model,
  pays_import: c.pays_import, categorie: c.categorie, source: c.source,
});

// ── Brique B : fige la sortie computeMargin (PAR UNITÉ) en breakdown persistable ────
// On LIT le retour du moteur et on le STOCKE tel quel (clés = noms moteur). On n'invente
// aucun poste : douane/tvaImport/tvaNetCost sont exposés séparément par computeMargin,
// le reste du détail de coutRendu (achat/port) reste interne au moteur (non exposé) →
// non persisté ici. shop_taxes_included (résolu) accompagne, pour gater plus tard la note
// TVA collectée (chantier d'affichage SÉPARÉ). Identité réconciliée au centime :
//   revenu − coutRendu − shopifyCost − stripeCost − retoursCost − adsCost − fraisFixes
//   = margeNette (= unit_net_margin).
export function buildMarginBreakdown(m, shopTaxesIncluded) {
  return {
    revenu: m.revenu, coutRendu: m.coutRendu,
    douane: m.douane, tvaImport: m.tvaImport, tvaNetCost: m.tvaNetCost,
    shopifyCost: m.shopifyCost, stripeCost: m.stripeCost,
    retoursCost: m.retoursCost, adsCost: m.adsCost, fraisFixes: m.fraisFixes,
    customsRate: m.customsRate, vatRate: m.vatRate,
    shop_taxes_included: shopTaxesIncluded === true,
  };
}

// Reconstruit l'engineInput d'une ligne DÉJÀ ingérée, depuis ses intrants FIGÉS
// (cost_snapshot_json) + net_unit_revenue stocké + order_created_at — SANS l'objet line
// Shopify d'origine (le backfill lit order_margins, pas Shopify). Mêmes constantes D3
// (processorFixedFee/retours/ads/fraisRetour = 0) qu'à l'ingestion → reproduit margeNette
// SSI les taux (shop_plans) et shopTaxesIncluded n'ont pas dérivé depuis l'ingestion.
export function engineInputFromSnapshot(snapshot, netUnitRevenue, orderCreatedAt, shopSettings) {
  const c = snapshot ?? {};
  return {
    prixVente:         num(netUnitRevenue),
    prixAchat:         num(c.prix_achat),
    categorie:         c.categorie,
    paysImport:        c.pays_import,
    shipping:          num(c.port_entrant),
    qty:               intPos(c.qty_par_lot, 1),
    coutEmballage:     num(c.cout_emballage),
    vatRegime:         c.vat_regime,
    shippingModel:     c.shipping_model,
    shopTaxesIncluded: shopSettings.shopTaxesIncluded !== false,
    shopifyFee:        num(shopSettings.shopifyFee),
    stripeFee:         num(shopSettings.stripeFee),
    processorFixedFee: 0,
    retours:           0,
    ads:               0,
    fraisRetour:       0,
    now:               new Date(orderCreatedAt),
  };
}

// ── Re-run backfill d'UNE ligne existante : rejoue computeMargin, AUTO-VALIDANT ──────
// N'émet le breakdown QUE si Σ(postes) retombe sur unit_net_margin DÉJÀ stocké au centime
// (garde-fou F1 : taux/taxesIncluded ont pu dériver depuis l'ingestion → on ne réécrit
// jamais un détail qui contredit le total figé). Ne MUTE pas la ligne (lecture pure).
//   { ok:true, breakdown }                          → l'appelant fait l'UPDATE ciblé
//   { ok:false, reason:"no_snapshot" }               → ligne sans coût figé, rien à rejouer
//   { ok:false, reason:"reconcile_mismatch", ... }   → dérive → SKIP, champ reste null
export function backfillRowBreakdown(row, shopSettings, { computeMargin = _computeMargin } = {}) {
  if (row.cost_source === "missing" || row.unit_net_margin == null || !row.cost_snapshot_json) {
    return { ok: false, reason: "no_snapshot" };
  }
  const input = engineInputFromSnapshot(row.cost_snapshot_json, row.net_unit_revenue, row.order_created_at, shopSettings);
  const m = computeMargin(input);
  const stored = num(row.unit_net_margin);
  if (Math.abs(m.margeNette - stored) >= 0.005) {
    return { ok: false, reason: "reconcile_mismatch", replayed: m.margeNette, stored };
  }
  return { ok: true, breakdown: buildMarginBreakdown(m, input.shopTaxesIncluded) };
}

// ── Construit la ligne d'historique d'UNE ligne de commande ─────────────────
// margeNette de computeMargin est PAR UNITÉ → agrégation × effective_qty (somme).
// Le fixe processeur n'est PAS soustrait ici : allocateOrderFixedFee le fait au prorata.
// costRow null → cost_source='missing', marges null (jamais de marge fausse).
export function buildHistoryRow(order, line, costRow, shopSettings, { computeMargin = _computeMargin, onFallback } = {}) {
  const quantity     = intPos(line.quantity, 0);
  const refundedQty  = effectiveRefundedQty(order.refunds, line.id);
  const effectiveQty = Math.max(0, quantity - refundedQty); // clamp ≥ 0 (D4)
  const base = {
    order_id:         order.id,
    line_item_id:     line.id,
    variant_id:       line.variant?.id ?? null,
    product_id:       line.product?.id ?? null,
    order_created_at: order.createdAt,
    currency_code:    order.currencyCode ?? null,
    quantity, refunded_qty: refundedQty, effective_qty: effectiveQty,
  };

  if (!costRow) {
    return { ...base, net_unit_revenue: null, unit_net_margin: null, line_net_revenue: null,
             line_net_margin: null, allocated_fixed_fee: null, cost_source: "missing",
             cost_snapshot_json: null, margin_breakdown_json: null };
  }

  const engineInput     = mapLineToEngineInput(line, costRow, shopSettings, order.createdAt, { onFallback });
  const netUnit         = engineInput.prixVente;
  const m               = computeMargin(engineInput);                  // ← moteur, jamais réécrit
  const unitNetMargin   = m.margeNette;
  const lineNetRevenue  = netUnit * effectiveQty;                      // agrégat (somme d'unités)
  const lineNetMargin   = unitNetMargin * effectiveQty;               // fixe soustrait à l'agrégation
  return {
    ...base,
    net_unit_revenue: netUnit,
    unit_net_margin:  unitNetMargin,
    line_net_revenue: lineNetRevenue,
    line_net_margin:  lineNetMargin,
    allocated_fixed_fee: 0,
    cost_source:      costRow.source ?? "estimated",
    cost_snapshot_json: snapshotCosts(costRow),
    // Brique B : breakdown figé nativement (sortie computeMargin du même engineInput).
    margin_breakdown_json: buildMarginBreakdown(m, engineInput.shopTaxesIncluded),
  };
}

// ── D3 : fixe processeur imputé UNE fois par commande, au prorata du revenu ──
// fixe_ligne = fixe × (line_net_revenue / Σ line_net_revenue). Σ=0 → 0 partout
// (jamais de division par zéro). Lignes 'missing' (revenu null) : ignorées, fee null.
// line_net_margin intègre le fixe après cette étape.
export function allocateOrderFixedFee(rows, fixedFee) {
  const priced = rows.filter((r) => r.line_net_revenue != null);
  const total  = priced.reduce((s, r) => s + r.line_net_revenue, 0);
  for (const r of rows) {
    if (r.line_net_revenue == null) continue;          // missing → reste null
    const share = total > 0 ? r.line_net_revenue / total : 0;
    const fee   = fixedFee * share;
    r.allocated_fixed_fee = fee;
    r.line_net_margin     = r.line_net_margin - fee;
  }
  return rows;
}

// ── Commandes DISTINCTES parmi des lignes ingérées — PUR (base du plafond d'alerting, C4a) ──
// Une ligne = un line item ; plusieurs lignes partagent un order_id → 1 commande. Robuste :
//   • entrée non-tableau (null/undefined) → 0 ;
//   • order_id manquant/null/"" sur une ligne → IGNORÉE (pas comptée). Choix : on ne compte que
//     des commandes RÉELLEMENT identifiées. Compter une ligne sans order_id gonflerait le volume →
//     bascule du plafond à tort AU DÉTRIMENT du marchand (alerting coupé prématurément). En sous-
//     comptant on ne pénalise jamais le marchand pour une lacune de données. (order_margins.order_id
//     est NOT NULL au schéma → garde défensive.)
export function countDistinctOrders(rows) {
  if (!Array.isArray(rows)) return 0;
  const ids = new Set();
  for (const r of rows) {
    const id = r?.order_id;
    if (id != null && id !== "") ids.add(id);
  }
  return ids.size;
}

// ── Orchestration pure d'une commande → lignes d'historique prêtes à upsert ──
// costLookup(variantId) → costRow | null. Lignes sans variant NI product ignorées
// (tip / frais custom / remise globale : pas un produit).
export function buildOrderHistoryRows(order, costLookup, shopSettings, opts = {}) {
  const rows = [];
  for (const line of order.lineItems ?? []) {
    if (!line.variant?.id && !line.product?.id) continue; // pas un produit → ignoré
    const costRow = line.variant?.id ? (costLookup(line.variant.id) ?? null) : null;
    rows.push(buildHistoryRow(order, line, costRow, shopSettings, opts));
  }
  allocateOrderFixedFee(rows, num(shopSettings.processorFixedFee));
  return rows;
}
