// ── Simulateur (10.13) — PUR, déterministe : ré-évaluation du graphe avec leviers ─────────────
// Volume CONSTANT par défaut (décision 4) : un levier prix ne change pas le nombre de commandes ;
// seuls les leviers de conversion et de fréquence changent le volume. Chaque simulation renvoie
// ses hypothèses (affichées : « scénario, pas prévision »). Entrées = feuilles d'aggregate.
import { evaluate } from "./nodes.js";

const scale = (v, f) => (v == null ? null : v * f);
// Feuilles proportionnelles au CA (prix/panier) et au volume (commandes).
const REVENUE_LEAVES = ["ca_brut", "remises", "rembours", "taxes", "shipping_charged_ht", "known_ca_ht", "known_ca_ttc", "unknown_ca_ht", "attributed_ca_ttc", "payment_fees"];
const VOLUME_LEAVES  = ["orders", "units", "known_orders", "unknown_cost_lines", "cogs", "shipping_cost", "packaging_cost", "returns_cost", "commissions", "attributed_orders", "attributed_cm2", "first_orders_count", "first_orders_cm2", ...REVENUE_LEAVES];

// levers : { price_factor, cogs_factor, aov_factor, cvr_factor, cac, return_rate_factor, frequency_factor }
// overrides : valeurs brutes de feuilles ou de nœuds, appliquées EN DERNIER (priorité absolue).
export function applyLevers(inputs = {}, levers = {}) {
  const s = { ...inputs };
  const assumptions = [];
  const f = (k) => (levers[k] == null ? null : +levers[k]);

  if (f("price_factor") != null && f("price_factor") !== 1) {
    for (const k of REVENUE_LEAVES) s[k] = scale(s[k], f("price_factor"));
    assumptions.push({ key: "volume_constant_price", factor: f("price_factor") });
  }
  if (f("cogs_factor") != null && f("cogs_factor") !== 1) {
    s.cogs = scale(s.cogs, f("cogs_factor"));
    assumptions.push({ key: "cogs_factor", factor: f("cogs_factor") });
  }
  if (f("aov_factor") != null && f("aov_factor") !== 1) {
    // Panier plus grand à commandes constantes : CA, unités et coût produit suivent ; port et
    // emballage par commande ne bougent pas (c'est la dilution du brief 10.2).
    for (const k of [...REVENUE_LEAVES, "units", "cogs", "attributed_cm2"]) s[k] = scale(s[k], f("aov_factor"));
    assumptions.push({ key: "orders_constant_aov", factor: f("aov_factor") });
  }
  if (f("cvr_factor") != null && f("cvr_factor") !== 1) {
    for (const k of [...new Set(VOLUME_LEAVES)]) s[k] = scale(s[k], f("cvr_factor"));
    s.purchase_sessions = scale(s.purchase_sessions, f("cvr_factor"));
    s.new_customers = scale(s.new_customers, f("cvr_factor"));
    s.attributed_new_customers = scale(s.attributed_new_customers, f("cvr_factor"));
    assumptions.push({ key: "sessions_and_ad_spend_constant", factor: f("cvr_factor") });
  }
  if (f("frequency_factor") != null && f("frequency_factor") !== 1) {
    // Plus de commandes par client, mêmes clients, même acquisition.
    for (const k of [...new Set(VOLUME_LEAVES)]) s[k] = scale(s[k], f("frequency_factor"));
    assumptions.push({ key: "customers_and_ad_spend_constant", factor: f("frequency_factor") });
  }
  if (f("return_rate_factor") != null && f("return_rate_factor") !== 1) {
    s.rembours = scale(s.rembours, f("return_rate_factor"));
    s.returns_cost = scale(s.returns_cost, f("return_rate_factor"));
    assumptions.push({ key: "return_rate_factor", factor: f("return_rate_factor") });
  }
  if (f("cac") != null) {
    const base = s.attributed_new_customers ?? s.new_customers;
    if (base != null) { s.ad_spend = f("cac") * base; assumptions.push({ key: "ad_spend_from_cac", cac: f("cac"), new_customers: base }); }
  }
  return { inputs: s, assumptions };
}

export function simulate({ inputs = {}, levers = {}, overrides = {} } = {}) {
  const before = evaluate(inputs);
  const { inputs: simInputs, assumptions } = applyLevers(inputs, levers);
  const after = evaluate(simInputs, overrides);
  const delta = {};
  for (const k of Object.keys(after)) delta[k] = before[k] == null || after[k] == null ? null : after[k] - before[k];
  return { before, after, delta, assumptions, levers, overrides, note: "scenario_not_forecast" };
}

// Recherche de seuil (« jusqu'où X peut baisser avant que Y devienne perdant ») : bissection sur UN
// levier, en supposant la monotonie de `node` par rapport au levier sur [lo, hi]. Renvoie la valeur
// du levier où `node` atteint `target`, ou null si la cible n'est pas encadrée.
export function findThreshold({ inputs, lever, node, target = 0, lo, hi, iterations = 50, overrides = {} } = {}) {
  const at = (x) => simulate({ inputs, levers: { [lever]: x }, overrides }).after[node];
  let vLo = at(lo), vHi = at(hi);
  if (vLo == null || vHi == null) return null;
  if ((vLo - target) * (vHi - target) > 0) return null; // pas de traversée sur l'intervalle
  let a = lo, b = hi;
  for (let i = 0; i < iterations; i++) {
    const m = (a + b) / 2;
    const vm = at(m);
    if (vm == null) return null;
    if ((vm - target) * (vLo - target) <= 0) { b = m; vHi = vm; } else { a = m; vLo = vm; }
  }
  return (a + b) / 2;
}
