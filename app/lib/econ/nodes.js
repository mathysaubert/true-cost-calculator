// ── Catalogue des nœuds du graphe économique + évaluateur — PUR ───────────────────────────────
// UNE déclaration par nœud : entrées, formule, unité, niveau, repère, minData. Écrans, règles,
// alertes, IA et simulateur lisent ce catalogue ; aucun module ne recalcule un chiffre à côté.
// Les FEUILLES (sommes produites par aggregate.js) sont listées dans LEAF_INPUTS ; les nœuds
// dérivés s'évaluent dans l'ordre topologique. null se propage (jamais 0 par défaut) ; une
// division par une base ≤ 0 renvoie null.
//
// Bases (décisions A1/A7) : ROAS, BE-ROAS, ROAS cible, POAS en TTC ; CM2 %, MER, CAC en HT.
import { BENCHMARKS, MIN_DATA } from "./config.js";

const div = (a, b) => (a == null || b == null || !(b > 0) ? null : a / b);
const sub = (...xs) => (xs.some((x) => x == null) ? null : xs.reduce((s, x, i) => (i === 0 ? x : s - x), 0));
const add = (...xs) => (xs.some((x) => x == null) ? null : xs.reduce((s, x) => s + x, 0));
const pct = (v) => (v == null ? null : v * 100);

// Feuilles : sommes sur la période et le périmètre (boutique/produit/canal…), toutes en devise
// boutique. « known_* » = restreint aux lignes à coût CONNU (les autres sont comptées à part).
export const LEAF_INPUTS = [
  "orders", "units", "new_customers", "sessions", "atc_sessions", "checkout_sessions", "purchase_sessions",
  "ca_brut", "remises", "rembours", "taxes", "shipping_charged_ht",
  "known_ca_ht", "known_ca_ttc", "known_orders", "unknown_ca_ht", "unknown_cost_lines",
  "cogs", "shipping_cost", "packaging_cost", "payment_fees", "returns_cost",
  "ad_spend", "commissions", "fixed_costs",
  "attributed_ca_ttc", "attributed_cm2", "attributed_orders", "attributed_new_customers", "partner_new_customers",
  "first_orders_cm2", "first_orders_count", "target_margin_after_ads_pct", "main_product_price",
];

export const NODES = [
  // ── Revenus ──
  { id: "ca_net",  inputs: ["ca_brut", "remises", "rembours"], compute: (v) => sub(v.ca_brut, v.remises, v.rembours), unit: "money" },
  { id: "ca_ttc",  inputs: ["ca_net"], compute: (v) => v.ca_net, unit: "money" },
  { id: "ca_ht",   inputs: ["ca_net", "taxes"], compute: (v) => sub(v.ca_net, v.taxes), unit: "money" },
  { id: "aov",     inputs: ["ca_ht", "orders"], compute: (v) => div(v.ca_ht, v.orders), unit: "money", minData: MIN_DATA.aov, benchmark: BENCHMARKS.aov_vs_main_price },
  { id: "items_per_order", inputs: ["units", "orders"], compute: (v) => div(v.units, v.orders), unit: "ratio", minData: MIN_DATA.items_per_order },
  { id: "avg_unit_price",  inputs: ["ca_ht", "shipping_charged_ht", "units"], compute: (v) => div(sub(v.ca_ht, v.shipping_charged_ht), v.units), unit: "money", minData: MIN_DATA.avg_unit_price },
  // ── Marges (base = lignes à coût connu) ──
  { id: "cm1",     inputs: ["known_ca_ht", "cogs"], compute: (v) => sub(v.known_ca_ht, v.cogs), unit: "money" },
  { id: "cm1_pct", inputs: ["cm1", "known_ca_ht"], compute: (v) => pct(div(v.cm1, v.known_ca_ht)), unit: "pct" },
  { id: "cm2",     inputs: ["cm1", "shipping_cost", "packaging_cost", "payment_fees", "returns_cost"], compute: (v) => sub(v.cm1, v.shipping_cost, v.packaging_cost, v.payment_fees, v.returns_cost), unit: "money" },
  { id: "cm2_pct", inputs: ["cm2", "known_ca_ht"], compute: (v) => pct(div(v.cm2, v.known_ca_ht)), unit: "pct", minData: MIN_DATA.cm2_pct, benchmark: BENCHMARKS.cm2_pct },
  { id: "cm2_pct_ttc", inputs: ["cm2", "known_ca_ttc"], compute: (v) => pct(div(v.cm2, v.known_ca_ttc)), unit: "pct" },
  { id: "cm2_per_order", inputs: ["cm2", "known_orders"], compute: (v) => div(v.cm2, v.known_orders), unit: "money" },
  { id: "cm3",     inputs: ["cm2", "ad_spend", "commissions"], compute: (v) => sub(v.cm2, v.ad_spend, v.commissions), unit: "money" },
  { id: "cm3_per_order", inputs: ["cm3", "known_orders"], compute: (v) => div(v.cm3, v.known_orders), unit: "money" },
  { id: "net_result", inputs: ["cm3", "fixed_costs"], compute: (v) => sub(v.cm3, v.fixed_costs), unit: "money" },
  { id: "net_margin_pct", inputs: ["net_result", "known_ca_ht"], compute: (v) => pct(div(v.net_result, v.known_ca_ht)), unit: "pct" },
  // ── Seuils (A1 : TTC pour les ROAS) ──
  { id: "be_roas",     inputs: ["known_ca_ttc", "cm2"], compute: (v) => div(v.known_ca_ttc, v.cm2), unit: "ratio", minData: MIN_DATA.be_roas },
  { id: "target_roas", inputs: ["cm2_pct_ttc", "target_margin_after_ads_pct"], compute: (v) => {
      if (v.cm2_pct_ttc == null || v.target_margin_after_ads_pct == null) return null;
      const d = v.cm2_pct_ttc / 100 - v.target_margin_after_ads_pct / 100;
      return d > 0 ? 1 / d : null;
    }, unit: "ratio", minData: MIN_DATA.target_roas },
  { id: "be_cac",      inputs: ["first_orders_cm2", "first_orders_count"], compute: (v) => div(v.first_orders_cm2, v.first_orders_count), unit: "money", minData: MIN_DATA.be_cac },
  // ── Marketing ──
  { id: "marketing_spend", inputs: ["ad_spend", "commissions"], compute: (v) => add(v.ad_spend, v.commissions), unit: "money" },
  { id: "mer",         inputs: ["ca_ht", "marketing_spend"], compute: (v) => div(v.ca_ht, v.marketing_spend), unit: "ratio", minData: MIN_DATA.mer, benchmark: BENCHMARKS.mer },
  { id: "marketing_share", inputs: ["mer"], compute: (v) => (v.mer == null || !(v.mer > 0) ? null : 100 / v.mer), unit: "pct" },
  { id: "roas_utm",    inputs: ["attributed_ca_ttc", "ad_spend"], compute: (v) => div(v.attributed_ca_ttc, v.ad_spend), unit: "ratio", minData: MIN_DATA.roas_utm },
  { id: "poas",        inputs: ["attributed_cm2", "ad_spend"], compute: (v) => div(v.attributed_cm2, v.ad_spend), unit: "ratio", minData: MIN_DATA.poas, benchmark: BENCHMARKS.poas },
  { id: "cac_global",  inputs: ["marketing_spend", "new_customers"], compute: (v) => div(v.marketing_spend, v.new_customers), unit: "money", minData: MIN_DATA.cac_global },
  { id: "cac_paid",    inputs: ["ad_spend", "attributed_new_customers"], compute: (v) => div(v.ad_spend, v.attributed_new_customers), unit: "money", minData: MIN_DATA.cac_paid },
  { id: "cac_partners", inputs: ["commissions", "partner_new_customers"], compute: (v) => div(v.commissions, v.partner_new_customers), unit: "money" },
  { id: "contribution_per_new_customer_before_acq", inputs: ["aov", "cm2_pct"], compute: (v) => (v.aov == null || v.cm2_pct == null ? null : v.aov * v.cm2_pct / 100), unit: "money" },
  { id: "contribution_per_new_customer_after_acq",  inputs: ["contribution_per_new_customer_before_acq", "cac_global"], compute: (v) => sub(v.contribution_per_new_customer_before_acq, v.cac_global), unit: "money" },
  // ── Conversion ──
  { id: "atc_rate",        inputs: ["atc_sessions", "sessions"], compute: (v) => pct(div(v.atc_sessions, v.sessions)), unit: "pct", minData: MIN_DATA.atc_rate, benchmark: BENCHMARKS.atc_rate },
  { id: "checkout_rate",   inputs: ["checkout_sessions", "sessions"], compute: (v) => pct(div(v.checkout_sessions, v.sessions)), unit: "pct", minData: MIN_DATA.checkout_rate, benchmark: BENCHMARKS.checkout_rate },
  { id: "completion_rate", inputs: ["purchase_sessions", "checkout_sessions"], compute: (v) => pct(div(v.purchase_sessions, v.checkout_sessions)), unit: "pct", minData: MIN_DATA.completion_rate },
  { id: "cvr",             inputs: ["purchase_sessions", "sessions"], compute: (v) => pct(div(v.purchase_sessions, v.sessions)), unit: "pct", minData: MIN_DATA.cvr, benchmark: BENCHMARKS.cvr },
];

const byId = new Map(NODES.map((n) => [n.id, n]));
export const nodeById = (id) => byId.get(id) ?? null;

// Ordre topologique (levée d'erreur si cycle ou entrée inconnue) — calculé une fois.
export function topologicalOrder(nodes = NODES, leaves = LEAF_INPUTS) {
  const known = new Set(leaves);
  const pending = new Map(nodes.map((n) => [n.id, n]));
  const order = [];
  let progressed = true;
  while (pending.size && progressed) {
    progressed = false;
    for (const [id, n] of pending) {
      for (const i of n.inputs) if (!known.has(i) && !pending.has(i)) throw new Error(`Nœud ${id} : entrée inconnue « ${i} »`);
      if (n.inputs.every((i) => known.has(i))) { order.push(n); known.add(id); pending.delete(id); progressed = true; }
    }
  }
  if (pending.size) throw new Error(`Cycle dans le graphe : ${[...pending.keys()].join(", ")}`);
  return order;
}
const ORDER = topologicalOrder();

// Évalue tous les nœuds depuis des feuilles (valeurs manquantes → null, jamais 0).
export function evaluate(inputs = {}, overrides = {}) {
  const v = {};
  for (const leaf of LEAF_INPUTS) v[leaf] = overrides[leaf] !== undefined ? overrides[leaf] : (inputs[leaf] === undefined ? null : inputs[leaf]);
  for (const n of ORDER) v[n.id] = overrides[n.id] !== undefined ? overrides[n.id] : n.compute(v);
  return v;
}
