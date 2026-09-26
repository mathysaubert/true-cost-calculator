// ── D1c — Section Produits (X6a) : liste par produit et audit catalogue Expert — PUR ─────────────
// Liste : CA HT, CM2, CM2 %, unités, statut de coût, depuis byProduct de l'agrégat (econ, intouché).
// Statut de coût : source de coût des lignes vendues sur la période (order_margins.cost_source) :
//   set        : toutes les lignes ont un coût saisi ou importé par le marchand ;
//   to_confirm : toutes les lignes ont un coût, au moins un vient de Shopify ou d'une estimation ;
//   partial    : une partie des lignes n'a aucun coût (leur CA est hors marge) ;
//   missing    : aucune ligne n'a de coût (CM2 non calculable, jamais 0).
// Audit : marge unitaire au prix catalogue par le calcul du Simulateur (S3, unitEconomics), classée
// avec le seuil du marchand (auditClassify.auditCategory, même frontière que l'alerte e-mail).
import { auditCategory } from "./auditClassify.js";
import { unitDefaultsFromSettings } from "./simulator/newProduct.js";

export const PRODUCT_COST_STATUSES = ["set", "to_confirm", "partial", "missing"];
export const PRODUCTS_MAX = 200;
export const AUDIT_GROUPS = ["loser", "risky", "winner"];
const MERCHANT_SOURCES = new Set(["confirmed", "imported"]);
const num = (v) => { if (v == null || v === "") return null; const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };

// rows : lignes order_margins (product_id, cost_source, is_gift_card) déjà restreintes à la période.
export function costSourcesByProduct(rows = []) {
  const out = new Map();
  for (const r of rows) {
    if (!r?.product_id || r.is_gift_card || r.cost_source === "excluded") continue;
    const c = out.get(r.product_id) ?? { merchant: 0, other: 0, missing: 0 };
    if (r.cost_source === "missing") c.missing++;
    else if (MERCHANT_SOURCES.has(r.cost_source)) c.merchant++;
    else c.other++;
    out.set(r.product_id, c);
  }
  return out;
}

// Statut depuis les compteurs ; sans compteur (lignes hors plafond), repli sur l'agrégat.
export function costStatus(sources, leaves = {}) {
  if (sources && sources.merchant + sources.other + sources.missing > 0) {
    const total = sources.merchant + sources.other + sources.missing;
    if (sources.missing === total) return "missing";
    if (sources.missing > 0) return "partial";
    return sources.other > 0 ? "to_confirm" : "set";
  }
  const known = num(leaves.known_ca_ht) ?? 0, unknown = num(leaves.unknown_ca_ht) ?? 0;
  if (known <= 0 && unknown > 0) return "missing";
  if (unknown > 0) return "partial";
  return "to_confirm";
}

// Une entrée de liste : CM2 et CM2 % seulement si une part du CA a un coût connu.
export function productListEntry({ id, title, entry = {}, sources = null }) {
  const n = entry.nodes ?? {}, l = entry.leaves ?? {};
  const known = num(n.known_ca_ht) ?? 0;
  return {
    id, title,
    ca_ht: num(n.ca_ht) ?? 0,
    orders: l.orders ?? 0,
    units: num(n.units) ?? 0,
    cm2: known > 0 ? num(n.cm2) : null,
    cm2_pct: known > 0 ? num(n.cm2_pct) : null,
    unknown_ca_ht: num(l.unknown_ca_ht) ?? 0,
    status: costStatus(sources, l),
  };
}

export function productSummary(list = []) {
  const counts = Object.fromEntries(PRODUCT_COST_STATUSES.map((s) => [s, 0]));
  let ca = 0, unknown = 0;
  for (const p of list) { counts[p.status] = (counts[p.status] ?? 0) + 1; ca += p.ca_ht; unknown += p.unknown_ca_ht; }
  return { counts, total: list.length, ca_ht: ca, unknown_ca_ht: unknown, unknown_share: ca > 0 ? (unknown / ca) * 100 : null };
}

export const PRODUCT_SORTS = ["ca_ht", "cm2", "cm2_pct", "units"];
export function sortProducts(list = [], sort = "ca_ht") {
  const key = PRODUCT_SORTS.includes(sort) ? sort : "ca_ht";
  // Les valeurs absentes (coût inconnu) vont en fin de liste, jamais comptées comme 0.
  return [...list].sort((a, b) => (a[key] == null) - (b[key] == null) || (b[key] ?? 0) - (a[key] ?? 0));
}
export const filterByStatus = (list = [], status = "all") => (PRODUCT_COST_STATUSES.includes(status) ? list.filter((p) => p.status === status) : list);

// Taux de retour pré-rempli dans l'audit = l'indicateur « Taux de retour » de l'app (kpis de
// loadOverview : part des commandes sorties de la fenêtre de retour ayant un retour ou un remboursement),
// arrondi à 0,1, seulement s'il est mesurable ; sinon null et le nombre de commandes qui manquent.
export function returnRateFromKpis(kpis = []) {
  const k = (kpis ?? []).find((x) => x?.id === "return_rate");
  if (k?.status === "ok" && Number.isFinite(Number(k.value))) return { returnRatePct: Math.round(Number(k.value) * 10) / 10, returnRateMissing: null, returnRateNoOrders: false };
  // Correctif 2026-09-26 : « missing » vaut { orders: 1 } quand AUCUNE commande n'est retenue (drapeau,
  // pas un nombre de commandes manquantes) ; seul orders_out_of_window est un vrai manque.
  const deficit = Number(k?.missing?.orders_out_of_window);
  return { returnRatePct: null, returnRateMissing: Number.isFinite(deficit) && deficit > 0 ? deficit : null, returnRateNoOrders: k?.missing?.orders != null };
}

// ── Audit : entrées unitaires d'un produit ─────────────────────────────────────────────────────
// vc : ligne variant_costs de la variante scannée (ou null) ; shopifyCost : coût unitaire Shopify.
// Coût marchand (saisi ou importé) prioritaire ; sinon coût Shopify, marqué « à confirmer » ;
// sinon aucun coût ⇒ null (le produit est compté « sans coût », jamais calculé avec 0).
export function auditInputs({ price, shopifyCost, vc = null, category, settings = {}, returnRatePct = null, pricesIncludeTax = true }) {
  const p = num(price);
  if (!(p > 0)) return null;
  const merchant = vc && MERCHANT_SOURCES.has(vc.source) && num(vc.prix_achat) > 0;
  const cost = merchant ? num(vc.prix_achat) : num(shopifyCost);
  if (!(cost > 0)) return null;
  const d = unitDefaultsFromSettings(settings);
  const inputs = {
    ...d,
    price_ttc: String(p), prix_achat: String(cost),
    port_entrant: merchant && vc.port_entrant != null ? String(vc.port_entrant) : "0",
    qty_par_lot: merchant && vc.qty_par_lot != null ? String(vc.qty_par_lot) : "1",
    vat_regime: (merchant && vc.vat_regime) || d.vat_regime || "assujetti",
    shipping_model: (merchant && vc.shipping_model) || d.shipping_model || "dropshipping",
    categorie: category ?? "Autre",
    prices_include_tax: pricesIncludeTax !== false,
  };
  if (returnRatePct != null) inputs.return_rate_pct = String(returnRatePct);
  return { inputs, cost_source: merchant ? "merchant" : "shopify" };
}

// Réglages manquants signalés avec le résultat (comptés 0 dans le calcul, jamais inventés).
export function auditAssumptions(settings = {}) {
  const d = unitDefaultsFromSettings(settings);
  return ["packaging", "shipping", "payment_pct", "return_cost"].filter((k) => d[k] == null);
}

// rows : [{ …, cm2_pct }] ⇒ groupes loser / risky / winner, du pire au meilleur dans chaque groupe.
export function classifyAuditRows(rows = [], thresholdPct = 0) {
  const groups = { loser: [], risky: [], winner: [] };
  for (const r of rows) groups[auditCategory(r.cm2_pct, thresholdPct)].push(r);
  for (const g of AUDIT_GROUPS) groups[g].sort((a, b) => (a.cm2_pct ?? -Infinity) - (b.cm2_pct ?? -Infinity));
  return groups;
}
