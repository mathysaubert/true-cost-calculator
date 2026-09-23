// ── Pont de contribution (§3.5 Phase 0) — PUR, additif, honnête ──────────────────────────────
// Décompose Δ CM2 (période − référence) en effets calculés UNIQUEMENT à partir des feuilles :
//   volume        = (commandes − commandes_ref) × CM2 par commande_ref
//   basket        = commandes × (CA/commande − CA/commande_ref) × taux CM2_ref
//   cogs_rate     = − CA × (COGS/CA − COGS/CA_ref)
//   order_cost_rate = − CA × (coûts de commande/CA − ref)      (port, emballage, paiement, retours)
//   residual      = Δ − Σ effets (affiché, jamais masqué ; ≈ 0 par construction sur des feuilles complètes)
// CM3 ajoute ads = −(pub − pub_ref) et commissions = −(commissions − ref).
// Une feuille nulle sur l'une des périodes → l'effet est null, `explained` = 0 (jamais inventé).
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const div = (a, b) => (a == null || b == null || !(b > 0) ? null : a / b);
export const BRIDGE_FACTORS = ["volume", "basket", "cogs_rate", "order_cost_rate"];
export const BRIDGE_FACTORS_CM3 = [...BRIDGE_FACTORS, "ads", "commissions"];

function orderCosts(l) {
  const parts = ["shipping_cost", "packaging_cost", "payment_fees", "returns_cost"].map((k) => num(l[k]));
  return parts.some((v) => v == null) ? null : parts.reduce((s, v) => s + v, 0);
}

// cur, ref : feuilles finalisées (aggregate.shop.leaves ou reference.leaves). node : "cm2" | "cm3".
export function contributionBridge(cur = {}, ref = {}, node = "cm2") {
  const c = { orders: num(cur.known_orders), ca: num(cur.known_ca_ht), cogs: num(cur.cogs), oc: orderCosts(cur), ads: num(cur.ad_spend), comm: num(cur.commissions) };
  const r = { orders: num(ref.known_orders), ca: num(ref.known_ca_ht), cogs: num(ref.cogs), oc: orderCosts(ref), ads: num(ref.ad_spend), comm: num(ref.commissions) };
  const cm2 = (x) => (x.ca == null || x.cogs == null || x.oc == null ? null : x.ca - x.cogs - x.oc);
  const cm2c = cm2(c), cm2r = cm2(r);
  const valueC = node === "cm3" ? (cm2c == null || c.ads == null || c.comm == null ? null : cm2c - c.ads - c.comm) : cm2c;
  const valueR = node === "cm3" ? (cm2r == null || r.ads == null || r.comm == null ? null : cm2r - r.ads - r.comm) : cm2r;
  const delta = valueC == null || valueR == null ? null : valueC - valueR;
  const factors = node === "cm3" ? BRIDGE_FACTORS_CM3 : BRIDGE_FACTORS;
  const effects = Object.fromEntries(factors.map((f) => [f, null]));
  if (delta == null || !(r.orders > 0) || !(c.orders > 0) || !(r.ca > 0) || !(c.ca > 0)) {
    return { node, delta, value: valueC, reference: valueR, effects, residual: null, explained: 0, ranked: [] };
  }
  const cm2PerOrderRef = cm2r / r.orders;
  const marginRateRef = cm2r / r.ca;
  const aovC = c.ca / c.orders, aovR = r.ca / r.orders;
  effects.volume = (c.orders - r.orders) * cm2PerOrderRef;
  effects.basket = c.orders * (aovC - aovR) * marginRateRef;
  effects.cogs_rate = -c.ca * (div(c.cogs, c.ca) - div(r.cogs, r.ca));
  effects.order_cost_rate = -c.ca * (div(c.oc, c.ca) - div(r.oc, r.ca));
  if (node === "cm3") { effects.ads = -(c.ads - r.ads); effects.commissions = -(c.comm - r.comm); }
  const sum = factors.reduce((s, f) => s + effects[f], 0);
  const residual = delta - sum;
  const explained = Math.abs(delta) > 1e-9 ? Math.max(0, 1 - Math.abs(residual) / Math.abs(delta)) : 1;
  const ranked = factors.map((f) => ({ factor: f, amount: effects[f], share: Math.abs(delta) > 1e-9 ? Math.abs(effects[f]) / Math.abs(delta) : 0 }))
    .filter((e) => Math.sign(e.amount) === Math.sign(delta) && Math.abs(e.amount) > 1e-9)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { node, delta, value: valueC, reference: valueR, effects, residual, explained, ranked };
}
