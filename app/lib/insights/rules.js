// ── Catalogue de règles (§3.4 Phase 0) — PUR ─────────────────────────────────────────────────
// Chaque règle lit les sorties du moteur (nœuds, feuilles, trous, compteurs, modules, pont) et
// renvoie null (pas de signal) ou un signal structuré : variables de catalogue, preuves (valeurs
// COPIÉES du moteur), impact sur la période (formule déclarée, appliquée à des valeurs du moteur),
// cause (portée par le pont seulement), levier de simulation, action unique, urgence, facilité,
// réversibilité. Aucune phrase ici : les textes vivent dans les catalogues (insight.<id>.*).
// kind : loss | degradation | opportunity | data | context (→ urgence par défaut).
import { RULE_THRESHOLDS as T, URGENCY, EASE, REVERSIBILITY } from "./config.js";
import { BENCHMARKS } from "../econ/config.js";

const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const pct = (a, b) => (a == null || b == null || !(b > 0) ? null : (a / b) * 100);
const ev = (node, value, unit) => ({ node, value, unit });

// Facteur du pont le plus fort dans le sens de l'écart, ou null (jamais de cause inventée).
function causeFromBridge(bridge) {
  if (!bridge || bridge.delta == null || !bridge.ranked.length) return null;
  const top = bridge.ranked.slice(0, 2);
  return { factor: top[0].factor, contributions: top.map((e) => ({ factor: e.factor, amount: e.amount, share: e.share })), explained: bridge.explained };
}

export const RULES = [
  {
    id: "cm2_below_target", kind: "degradation", needs: [], subject: "shop", lever: "price", cta: { kind: "simulate", target: "price_factor" },
    detect: ({ current, settings }) => {
      const n = current.shop.nodes, l = current.shop.leaves;
      const target = num(settings.profitability_threshold_pct) > 0 ? num(settings.profitability_threshold_pct) : BENCHMARKS.cm2_pct.low;
      if (n.cm2_pct == null || n.cm2_pct >= target) return null;
      const cogsShare = pct(l.cogs, l.known_ca_ht);
      const orderCostShare = pct((l.shipping_cost ?? 0) + (l.packaging_cost ?? 0) + (l.payment_fees ?? 0) + (l.returns_cost ?? 0), l.known_ca_ht);
      return {
        vars: { cm2_pct: n.cm2_pct, target, known_share: pct(l.known_ca_ht, (l.known_ca_ht ?? 0) + (l.unknown_ca_ht ?? 0)), cogs_share: cogsShare, order_cost_share: orderCostShare, x: Math.round(target - n.cm2_pct), y: Math.round(target - n.cm2_pct) },
        evidence: [ev("cm2_pct", n.cm2_pct, "pct"), ev("known_ca_ht", l.known_ca_ht, "money"), ev("cogs", l.cogs, "money")],
        impact: { formula: "(target − cm2_pct) / 100 × known_ca_ht", point: ((target - n.cm2_pct) / 100) * l.known_ca_ht },
        cause: null,
        simulation: { levers: { price_factor: 1 + (target - n.cm2_pct) / 100 }, node: "cm2_pct" },
        urgency: URGENCY.degradation, ease: EASE.simulate, reversibility: REVERSIBILITY.price,
      };
    },
  },
  {
    id: "cm2_drop", kind: "degradation", needs: [], subject: "shop", lever: "cost", usesReference: true, cta: { kind: "open_section", target: "profit" },
    detect: ({ current, reference, bridgeCm2 }) => {
      const n = current.shop.nodes, r = reference?.nodes ?? {};
      if (n.cm2_pct == null || r.cm2_pct == null) return null;
      const deltaPts = n.cm2_pct - r.cm2_pct;
      if (deltaPts > -T.cm2_drop_points) return null;
      const cause = causeFromBridge(bridgeCm2);
      const c = cause?.contributions ?? [];
      return {
        vars: { delta_pts: Math.abs(deltaPts), cm2_pct: n.cm2_pct, prev_cm2_pct: r.cm2_pct, factor_1: c[0]?.factor ?? null, share_1: c[0] ? c[0].share * 100 : null, factor_2: c[1]?.factor ?? null, share_2: c[1] ? c[1].share * 100 : null, unexplained: bridgeCm2 ? (1 - bridgeCm2.explained) * 100 : null },
        evidence: [ev("cm2_pct", n.cm2_pct, "pct"), ev("cm2_pct_reference", r.cm2_pct, "pct"), ev("cm2", n.cm2, "money"), ev("cm2_reference", bridgeCm2?.reference ?? null, "money")],
        impact: { formula: "Δ CM2 (pont)", point: bridgeCm2?.delta ?? null },
        cause, explained: bridgeCm2?.explained ?? null,
        simulation: cause ? { levers: {}, node: "cm2", restore: cause.factor } : null,
        urgency: URGENCY.degradation, ease: EASE.open_section, reversibility: REVERSIBILITY.price,
      };
    },
  },
  {
    id: "revenue_vs_contribution", kind: "degradation", needs: [], subject: "shop", lever: "cost", usesReference: true, cta: { kind: "open_section", target: "profit" },
    detect: ({ current, reference, bridgeCm2 }) => {
      const n = current.shop.nodes, r = reference?.nodes ?? {}, rl = reference?.leaves ?? {};
      if (n.ca_ht == null || r.ca_ht == null || n.cm2 == null || bridgeCm2?.reference == null) return null;
      const revDelta = pct(n.ca_ht - r.ca_ht, r.ca_ht);
      const cm2Delta = pct(n.cm2 - bridgeCm2.reference, Math.abs(bridgeCm2.reference));
      if (revDelta == null || revDelta < T.revenue_growth_pct || cm2Delta == null || cm2Delta > 0) return null;
      const cause = causeFromBridge(bridgeCm2);
      const marginRateRef = rl.known_ca_ht > 0 ? bridgeCm2.reference / rl.known_ca_ht : null;
      const gap = marginRateRef == null || current.shop.leaves.known_ca_ht == null ? null : marginRateRef * current.shop.leaves.known_ca_ht - n.cm2;
      return {
        vars: { rev_delta: revDelta, cm2_delta: cm2Delta, factor_1: cause?.factor ?? null, share_1: cause ? cause.contributions[0].share * 100 : null, missing_share: pct(current.shop.leaves.unknown_ca_ht, n.ca_ht) },
        evidence: [ev("ca_ht", n.ca_ht, "money"), ev("ca_ht_reference", r.ca_ht, "money"), ev("cm2", n.cm2, "money"), ev("cm2_reference", bridgeCm2.reference, "money")],
        impact: { formula: "taux CM2 de référence × CA HT connu − CM2", point: gap },
        cause, explained: bridgeCm2?.explained ?? null,
        simulation: cause ? { levers: {}, node: "cm2", restore: cause.factor } : null,
        urgency: URGENCY.degradation, ease: EASE.open_section, reversibility: REVERSIBILITY.price,
      };
    },
  },
  {
    id: "refund_pressure", kind: "degradation", needs: [], subject: "shop", lever: "returns", cta: { kind: "open_section", target: "profit" },
    detect: ({ current, reference }) => {
      const l = current.shop.leaves, rl = reference?.leaves ?? {};
      const share = pct(l.rembours, l.ca_brut);
      if (share == null) return null;
      const refShare = pct(rl.rembours, rl.ca_brut);
      const rising = refShare != null && share - refShare >= T.refund_rise_points;
      if (share < T.refund_share_pct && !rising) return null;
      const reasons = current.returns?.reason_shares ?? {};
      const top = Object.entries(reasons).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
      const excess = Math.max(0, (share - T.refund_share_pct) / 100) * l.ca_brut;
      return {
        vars: { refund_share: share, refunded: l.rembours, gross: l.ca_brut, reason: top?.[0] ?? null, reason_share: top?.[1] ?? null, target_rate: T.refund_share_pct },
        evidence: [ev("rembours", l.rembours, "money"), ev("ca_brut", l.ca_brut, "money"), ev("refund_share", share, "pct")],
        impact: { formula: "max(0, part − 5 %) × CA brut", point: excess > 0 ? -excess : null },
        cause: top ? { factor: "return_reason", contributions: [{ factor: top[0], amount: null, share: (top[1] ?? 0) / 100 }], explained: null } : null,
        simulation: { levers: { return_rate_factor: share > 0 ? T.refund_share_pct / share : 1 }, node: "cm2" },
        urgency: URGENCY.degradation, ease: EASE.open_section, reversibility: REVERSIBILITY.ad_budget,
      };
    },
  },
  {
    id: "discount_weight", kind: "opportunity", needs: [], subject: "shop", lever: "price", cta: { kind: "simulate", target: "price_factor" },
    detect: ({ current }) => {
      const l = current.shop.leaves;
      const share = pct(l.remises, l.ca_brut);
      if (share == null || share < T.discount_share_pct) return null;
      const codes = Object.entries(current.byCode ?? {}).sort((a, b) => (b[1].leaves.ca_ht ?? 0) - (a[1].leaves.ca_ht ?? 0)).slice(0, 3).map(([c]) => c);
      const excess = ((share - T.discount_share_pct) / 100) * l.ca_brut;
      return {
        vars: { discount_share: share, discounts: l.remises, gross: l.ca_brut, top_codes: codes.join(", ") || null, x: 5 },
        evidence: [ev("remises", l.remises, "money"), ev("ca_brut", l.ca_brut, "money")],
        impact: { formula: "(part − 15 %) × CA brut", point: excess },
        cause: null,
        simulation: { levers: { price_factor: 1 + 0.05 }, node: "cm2" },
        urgency: URGENCY.opportunity, ease: EASE.simulate, reversibility: REVERSIBILITY.ad_budget,
      };
    },
  },
  {
    id: "cost_coverage", kind: "data", needs: [], subject: "shop", lever: "data", cta: { kind: "fix_data", target: "costs" },
    detect: ({ current }) => {
      const g = current.dataGaps ?? {}, l = current.shop.leaves;
      if (!(num(g.unknown_cost_lines) > 0)) return null;
      const products = Object.entries(current.byProduct ?? {}).filter(([, p]) => (p.leaves.unknown_cost_lines ?? 0) > 0).sort((a, b) => (b[1].leaves.unknown_ca_ht ?? 0) - (a[1].leaves.unknown_ca_ht ?? 0));
      const top = products[0];
      const ca = (l.known_ca_ht ?? 0) + (l.unknown_ca_ht ?? 0);
      return {
        vars: { lines: g.unknown_cost_lines, unknown_share: pct(l.unknown_ca_ht, ca), products: products.length, top_product: top?.[0] ?? null, top_share: top ? pct(top[1].leaves.unknown_ca_ht, l.unknown_ca_ht) : null },
        evidence: [ev("unknown_cost_lines", g.unknown_cost_lines, "count"), ev("unknown_ca_ht", l.unknown_ca_ht, "money")],
        impact: { formula: "inconnu tant que les coûts manquent", point: null },
        cause: null, simulation: null,
        unlocks: ["cm1", "cm2_pct", "net_result", "product_loss", "cm2_drop", "revenue_vs_contribution"],
        urgency: URGENCY.opportunity, ease: EASE.fix_data, reversibility: REVERSIBILITY.settings,
      };
    },
  },
  {
    id: "fees_unconfirmed", kind: "data", needs: [], subject: "shop", lever: "data", cta: { kind: "fix_data", target: "fees" },
    detect: ({ current, score, scoreIfFixed }) => {
      const g = current.dataGaps ?? {}, l = current.shop.leaves;
      const orders = num(g.unconfirmed_fees) + num(g.unconfirmed_shipping);
      if (!(orders > 0)) return null;
      const estimated = (l.payment_fees ?? 0) + (l.shipping_cost ?? 0);
      return {
        vars: { orders: Math.max(num(g.unconfirmed_fees) ?? 0, num(g.unconfirmed_shipping) ?? 0), score: score ?? null, score_after: scoreIfFixed?.fees ?? null },
        evidence: [ev("payment_fees", l.payment_fees, "money"), ev("shipping_cost", l.shipping_cost, "money"), ev("unconfirmed_fees", g.unconfirmed_fees, "count"), ev("unconfirmed_shipping", g.unconfirmed_shipping, "count")],
        impact: { formula: "frais de paiement + port estimés", point: estimated > 0 ? estimated : null, precision_only: true },
        cause: null, simulation: null,
        unlocks: ["cm2_pct", "be_roas"],
        urgency: URGENCY.context, ease: EASE.fix_data, reversibility: REVERSIBILITY.settings,
      };
    },
  },
  {
    id: "aov_vs_main_price", kind: "opportunity", needs: [], subject: "shop", lever: "basket", cta: { kind: "simulate", target: "aov_factor" },
    detect: ({ current, settings }) => {
      const n = current.shop.nodes;
      const price = num(settings.main_product_price);
      if (n.aov == null || price == null || !(price > 0)) return null;
      if (n.aov >= price * (1 + T.aov_over_main_price_pct / 100)) return null;
      const x = Math.round((T.aov_opportunity_factor - 1) * 100);
      const point = n.cm2_pct == null ? null : n.aov * (T.aov_opportunity_factor - 1) * (n.cm2_pct / 100) * (current.shop.leaves.known_orders ?? 0);
      return {
        vars: { aov: n.aov, main_price: price, x },
        evidence: [ev("aov", n.aov, "money"), ev("main_product_price", price, "money"), ev("cm2_pct", n.cm2_pct, "pct"), ev("known_orders", current.shop.leaves.known_orders, "count")],
        impact: { formula: "panier × 7 % × taux CM2 × commandes à coût connu", point },
        cause: null,
        simulation: { levers: { aov_factor: T.aov_opportunity_factor }, node: "cm2" },
        urgency: URGENCY.opportunity, ease: EASE.simulate, reversibility: REVERSIBILITY.price,
      };
    },
  },
  {
    id: "provisional_share", kind: "context", needs: [], subject: "shop", lever: null, cta: { kind: "open_section", target: "profit" },
    detect: ({ current, settings }) => {
      const share = current.shop.provisional_share;
      if (share == null || share < T.provisional_share_pct) return null;
      return { vars: { share, days: settings.return_window_days ?? 30 }, evidence: [ev("provisional_share", share, "pct")], impact: { formula: "contexte", point: null }, cause: null, simulation: null, urgency: URGENCY.context, ease: EASE.open_section, reversibility: REVERSIBILITY.settings };
    },
  },
  {
    id: "product_concentration", kind: "context", needs: [], subject: "product", lever: null, cta: { kind: "open_section", target: "products" },
    detect: ({ current }) => {
      const n = current.shop.nodes;
      const entries = Object.entries(current.byProduct ?? {}).map(([id, p]) => ({ id, ca: p.nodes.ca_ht ?? 0, cm2_pct: p.nodes.cm2_pct })).sort((a, b) => b.ca - a.ca);
      const top = entries[0];
      if (!top || !(n.ca_ht > 0)) return null;
      const share = (top.ca / n.ca_ht) * 100;
      if (share < T.concentration_share_pct) return null;
      const point = top.cm2_pct == null ? null : -(T.concentration_shock_pct / 100) * top.ca * (top.cm2_pct / 100);
      return { subjectKey: top.id, vars: { product: top.id, share }, evidence: [ev("product_ca_ht", top.ca, "money"), ev("ca_ht", n.ca_ht, "money")], impact: { formula: "−10 % × CA HT du produit × taux CM2 du produit", point }, cause: null, simulation: null, urgency: URGENCY.context, ease: EASE.open_section, reversibility: REVERSIBILITY.assortment };
    },
  },
  {
    id: "product_loss", kind: "loss", needs: [], subject: "product", lever: "price", cta: { kind: "open_section", target: "products" },
    detect: ({ current }) => {
      const losers = Object.entries(current.byProduct ?? {}).filter(([, p]) => p.nodes.cm2 != null && p.nodes.cm2 < 0 && (p.leaves.known_orders ?? 0) >= 3).sort((a, b) => a[1].nodes.cm2 - b[1].nodes.cm2);
      const top = losers[0];
      if (!top) return null;
      const [id, p] = top;
      const units = p.leaves.units ?? 0;
      return { subjectKey: id, vars: { product: id, cm2: units > 0 ? p.nodes.cm2 / units : p.nodes.cm2, units, landed: units > 0 && p.leaves.cogs != null ? p.leaves.cogs / units : null, price: units > 0 && p.leaves.known_ca_ht != null ? p.leaves.known_ca_ht / units : null, count: losers.length }, evidence: [ev("product_cm2", p.nodes.cm2, "money"), ev("product_units", units, "count")], impact: { formula: "CM2 négative du produit", point: p.nodes.cm2 }, cause: null, simulation: { levers: { price_factor: p.leaves.known_ca_ht > 0 ? 1 + Math.abs(p.nodes.cm2) / p.leaves.known_ca_ht : 1 }, node: "cm2" }, urgency: URGENCY.loss, ease: EASE.open_section, reversibility: REVERSIBILITY.price };
    },
  },
  {
    id: "cac_above_be", kind: "degradation", needs: ["ads"], subject: "shop", lever: "ad_budget", usesReference: true, cta: { kind: "simulate", target: "cac" },
    detect: ({ current, reference, thresholds }) => {
      const n = current.shop.nodes, l = current.shop.leaves, rl = reference?.leaves ?? {};
      const be = thresholds?.be_cac;
      if (n.cac_global == null || be == null || n.cac_global <= be) return null;
      return { vars: { cac: n.cac_global, be_cac: be, spend_delta: pct(l.ad_spend - (rl.ad_spend ?? 0), rl.ad_spend), new_delta: pct(l.new_customers - (rl.new_customers ?? 0), rl.new_customers) }, evidence: [ev("cac_global", n.cac_global, "money"), ev("be_cac", be, "money"), ev("new_customers", l.new_customers, "count")], impact: { formula: "(CAC − BE-CAC) × nouveaux clients", point: -(n.cac_global - be) * (l.new_customers ?? 0) }, cause: null, simulation: { levers: { cac: be }, node: "cm3" }, urgency: URGENCY.degradation, ease: EASE.simulate, reversibility: REVERSIBILITY.ad_budget };
    },
  },
  {
    id: "roas_below_be", kind: "degradation", needs: ["ads"], subject: "shop", lever: "ad_budget", cta: { kind: "open_section", target: "marketing" },
    detect: ({ current }) => {
      const n = current.shop.nodes, l = current.shop.leaves;
      if (n.roas_utm == null || n.be_roas == null || n.roas_utm >= n.be_roas) return null;
      return { vars: { roas: n.roas_utm, be_roas: n.be_roas }, evidence: [ev("roas_utm", n.roas_utm, "ratio"), ev("be_roas", n.be_roas, "ratio"), ev("ad_spend", l.ad_spend, "money")], impact: { formula: "dépense pub × (1 − ROAS / BE-ROAS)", point: -(l.ad_spend ?? 0) * (1 - n.roas_utm / n.be_roas) }, cause: null, simulation: null, urgency: URGENCY.degradation, ease: EASE.open_section, reversibility: REVERSIBILITY.ad_budget };
    },
  },
  {
    id: "mer_low", kind: "context", needs: ["ads"], subject: "shop", lever: "ad_budget", cta: { kind: "open_section", target: "marketing" },
    detect: ({ current }) => {
      const n = current.shop.nodes;
      if (n.mer == null || n.mer >= T.mer_min) return null;
      return { vars: { mer: n.mer, share: n.marketing_share }, evidence: [ev("mer", n.mer, "ratio")], impact: { formula: "contexte", point: null }, cause: null, simulation: null, urgency: URGENCY.context, ease: EASE.open_section, reversibility: REVERSIBILITY.ad_budget };
    },
  },
  {
    id: "no_ad_source", kind: "data", needs: [], subject: "shop", lever: "data", cta: { kind: "connect", target: "ads" },
    detect: ({ current, sources }) => {
      if (sources?.ads) return null;
      const attributed = current.shop.leaves.attributed_orders ?? 0;
      if (!(attributed > 0)) return null;
      return { vars: { orders: attributed }, evidence: [ev("attributed_orders", attributed, "count")], impact: { formula: "aucun", point: null }, cause: null, simulation: null, unlocks: ["cac_global", "mer", "poas", "be_roas"], urgency: URGENCY.opportunity, ease: EASE.connect, reversibility: REVERSIBILITY.settings };
    },
  },
  {
    id: "stock_reorder", kind: "degradation", needs: [], subject: "shop", lever: "logistics", cta: { kind: "open_section", target: "inventory" },
    detect: ({ current, variantCosts }) => {
      const st = current.stock;
      if (!st?.tracked || !st.reorder_now?.length) return null;
      const rows = st.reorder_now.map((v) => st.byVariant[v]).filter(Boolean);
      const lost = rows.reduce((s, r) => s + (r.lost_revenue ?? 0), 0);
      const lead = Math.max(0, ...rows.map((r) => (variantCosts?.get?.(r.variant_id)?.supplier_lead_days ?? 0)));
      return { vars: { variants: rows.length, lead }, evidence: [ev("reorder_now", rows.length, "count")], impact: { formula: "CA perdu par rupture (module stock)", point: lost > 0 ? -lost : null }, cause: null, simulation: null, urgency: URGENCY.degradation, ease: EASE.open_section, reversibility: REVERSIBILITY.logistics };
    },
  },
  {
    id: "otd_low", kind: "context", needs: [], subject: "shop", lever: "logistics", cta: { kind: "open_section", target: "inventory" },
    detect: ({ current }) => {
      const otd = current.shipping?.otd;
      if (otd == null || otd >= T.otd_min_pct) return null;
      return { vars: { otd }, evidence: [ev("otd", otd, "pct")], impact: { formula: "contexte", point: null }, cause: null, simulation: null, urgency: URGENCY.context, ease: EASE.open_section, reversibility: REVERSIBILITY.logistics };
    },
  },
];

export const RULE_IDS = RULES.map((r) => r.id);
export const ruleById = (id) => RULES.find((r) => r.id === id) ?? null;
