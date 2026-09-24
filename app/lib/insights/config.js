// ── Couche narrative (I0) — TABLES DE CONFIGURATION (pures, sans logique) ─────────────────────
// Arbitrages I0 du 2026-09-23 : D1 (référence), D2 (fourchettes), D8 (fiabilité), D11 (priorité).
// Comme MIN_DATA (A11) : une seule table par sujet, modifiable sans toucher aux modules.

// D11 — poids de la fonction de priorité (somme = 1) : impact et confiance à égalité.
export const PRIORITY_WEIGHTS = { impact: 0.3, urgency: 0.2, confidence: 0.3, ease: 0.1, reversibility: 0.1 };
export const PRIORITY_COUNT = 3;
// Impact normalisé quand la règle n'a pas de montant (données, contexte).
export const IMPACT_NORM_DEFAULT = { data: 0.5, context: 0.2 };

// Valeur numérique d'un niveau de confiance dans la fonction de priorité.
export const CONFIDENCE_VALUE = { confirmed: 1, likely: 0.7, to_verify: 0.3, simulation: 0.5 };

// Seuils de statut (§3.3 Phase 0) : part expliquée par le pont, part du CA touchée par un trou.
export const STATUS_RULES = {
  explained_confirmed: 0.8,   // pont : ≥ 80 % de l'écart expliqué → confirmé possible
  explained_likely: 0.5,      // 50-80 % → très probable ; en dessous → à vérifier
  gaps_confirmed: 0.10,       // trous ≤ 10 % du CA → confirmé possible
  gaps_likely: 0.30,          // ≤ 30 % → très probable ; au-delà → à vérifier
  reference_periods_confirmed: 4, // D1 : moins de 4 périodes de référence → très probable au mieux
};

// D2 (a) — demi-largeur de la fourchette selon le score de fiabilité, puis élargissement par statut.
export const UNCERTAINTY_BY_SCORE = [
  { min: 80, halfWidth: 0.10 },
  { min: 60, halfWidth: 0.20 },
  { min: 0,  halfWidth: 0.35 },
];
export const UNCERTAINTY_BY_STATUS = { confirmed: 0, likely: 0.05, to_verify: 0.15, simulation: 0.10 };

// D1 — référence : nombre de périodes moyennées ; « 6 mois » dès que l'historique le permet.
export const REFERENCE_PERIODS = 4;
// Compensation (effet en sens inverse) nommée dans la cause dès qu'elle atteint cette part de |Δ|.
export const CAUSE_OFFSET_MIN_SHARE = 0.1;
export const REFERENCE_SIX_MONTHS_DAYS = 182;

// Seuils de déclenchement des règles (repères du brief ; l'objectif marchand prime, A12).
export const RULE_THRESHOLDS = {
  cm2_drop_points: 2,            // baisse de CM2 % (points) vs référence
  revenue_growth_pct: 5,         // CA HT en hausse d'au moins 5 % (revenue_vs_contribution)
  refund_share_pct: 5,           // remboursements / CA brut
  refund_rise_points: 2,
  discount_share_pct: 15,        // remises / CA brut
  aov_over_main_price_pct: 10,   // panier moyen attendu ≥ prix principal + 10 %
  aov_opportunity_factor: 1.07,  // opportunité : panier +7 % (exemple du PDF)
  provisional_share_pct: 40,
  concentration_share_pct: 60,
  concentration_shock_pct: 10,   // impact : −10 % sur le produit dominant
  mer_min: 3,
  otd_min_pct: 95,
};

// Données minimales par règle (compteurs d'aggregate.counts) : sous seuil → « partial ».
export const RULE_MIN_DATA = {
  cm2_below_target:        { known_orders: 10 },
  cm2_drop:                { known_orders: 10 },
  revenue_vs_contribution: { known_orders: 10 },
  refund_pressure:         { orders: 10 },
  discount_weight:         { orders: 1 },
  cost_coverage:           { orders: 1 },
  fees_unconfirmed:        { orders: 1 },
  aov_vs_main_price:       { orders: 10 },
  provisional_share:       { orders: 1 },
  product_concentration:   { orders: 10 },
  product_loss:            { known_orders: 3 },
  cac_above_be:            { attributed_orders: 30, first_orders: 20 },
  roas_below_be:           { attributed_orders: 30 },
  mer_low:                 { orders: 30 },
  no_ad_source:            { orders: 1 },
  stock_reorder:           { sales_days: 14 },
  otd_low:                 { delivered: 20 },
};

// Urgence par nature de signal (§3.6) ; facilité et réversibilité par type d'action.
export const URGENCY = { loss: 1, degradation: 0.7, opportunity: 0.4, context: 0.2 };
export const EASE = { fix_data: 1, connect: 0.7, simulate: 0.7, open_section: 0.4 };
export const REVERSIBILITY = { settings: 1, ad_budget: 0.8, price: 0.6, assortment: 0.3, logistics: 0.5 };

// D8 — fiabilité des données : poids fixes documentés ; « non applicable » sort du dénominateur.
export const CONFIDENCE_RULES = [
  { id: "cost_coverage",   weight: 30, unlocks: ["cm1", "cm2_pct", "net_result", "product_loss", "cm2_drop", "revenue_vs_contribution"], cta: "fix_data" },
  { id: "ads_connected",   weight: 20, unlocks: ["cac_global", "mer", "poas", "be_roas", "cac_above_be", "roas_below_be"], cta: "connect" },
  { id: "shipping_costs",  weight: 15, unlocks: ["cm2_pct", "cost_per_order"], cta: "fix_data" },
  { id: "payment_fees",    weight: 10, unlocks: ["cm2_pct", "be_roas"], cta: "fix_data" },
  { id: "fixed_costs",     weight: 10, unlocks: ["net_result", "breakeven"], cta: "fix_data" },
  { id: "landed_cost",     weight: 10, unlocks: ["landed_cost", "margin_by_country"], cta: "fix_data" },
  { id: "currency",        weight: 5,  unlocks: ["totals"], cta: "open_section" },
];
export const CONFIDENCE_LEVELS = [{ min: 80, level: "high" }, { min: 60, level: "medium" }, { min: 0, level: "low" }];
