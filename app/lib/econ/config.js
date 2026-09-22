// ── Moteur économique — TABLES DE CONFIGURATION (pures, sans logique) ─────────────────────────
// Décision A11 : les seuils de données minimales vivent ICI, dans une seule table, modifiables
// sans toucher au moteur (ils seront ajustés avec les premiers utilisateurs). Décision A12 : les
// repères du brief sont des rappels ; l'objectif du marchand (profitability_threshold_pct) prime.

// Seuils de données minimales par nœud : sous ces comptes, le nœud renvoie « insuffisant » avec
// ce qui manque (« encore N commandes »), jamais un chiffre à la précision trompeuse (principe 6).
export const MIN_DATA = {
  aov:                { orders: 10 },
  items_per_order:    { orders: 10 },
  avg_unit_price:     { orders: 10 },
  cvr:                { sessions: 200, orders: 10 },
  atc_rate:           { sessions: 200 },
  checkout_rate:      { sessions: 200 },
  completion_rate:    { checkout_sessions: 20 },
  cm2_pct:            { known_orders: 10 },
  be_roas:            { known_orders: 10 },
  target_roas:        { known_orders: 10 },
  be_cac:             { first_orders: 20 },
  cac_global:         { orders: 30 },
  cac_paid:           { attributed_orders: 30 },
  roas_utm:           { attributed_orders: 30 },
  poas:               { attributed_orders: 30 },
  mer:                { orders: 30 },
  cohort_repeat:      { customers: 30 },            // + âge de cohorte ≥ k mois (vérifié à part)
  ltv_cm2:            { customers: 30, months: 6 },
  ltv_cac:            { customers: 30, months: 6 },
  cac_payback_months: { customers: 30, months: 3 },
  return_rate:        { orders_out_of_window: 50 },
  refund_rate:        { orders_out_of_window: 50 },
  otd:                { delivered: 20 },
  ship_delay_hours:   { shipped: 20 },
  stock_coverage_days:{ sales_days: 14 },
  growth_wow:         { days: 14 },
  growth_mom:         { months: 2 },
  growth_yoy:         { months: 13 },
};

// Repères du brief (§10). Bande CM2 40-60 = rappel (A12) ; l'objectif marchand prime.
export const BENCHMARKS = {
  cm2_pct:            { low: 40, high: 60 },
  mer:                { min: 3 },
  poas:               { min: 1 },
  ltv_cac:            { min: 3 },
  cvr:                { low: 1.5, high: 3 },
  atc_rate:           { low: 5, high: 10 },
  checkout_rate:      { low: 3, high: 6 },
  aov_vs_main_price:  { short: 10, good: 20, great: 30 },   // % au-dessus du prix du produit principal
  return_rate:        { max: 5, targetLow: 2, targetHigh: 3 },
  defective_rate:     { max: 1 },
  late_rate:          { max: 0.5 },
  not_as_described_rate: { max: 2 },
  otd:                { min: 95 },
  ship_delay_hours:   { max: 48 },
  stock_coverage_days:{ low: 30, high: 60 },
  seo_ctr_brand:      { low: 40, high: 60 },
  seo_ctr_nonbrand:   { low: 5, high: 10 },
};

// Taux de TVA STANDARD des 27 États membres (décision A8) — table à relire à chaque changement
// législatif ; les taux réduits ne sont portés que pour la France (FR_REDUCED_VAT_BY_CATEGORY,
// alignés sur engine.js VAT_RATES). Sert à la TVA à l'IMPORT (base douanière) d'un marchand UE.
export const EU_VAT_STANDARD = {
  AT: 0.20, BE: 0.21, BG: 0.20, HR: 0.25, CY: 0.19, CZ: 0.21, DK: 0.25, EE: 0.24, FI: 0.255,
  FR: 0.20, DE: 0.19, GR: 0.24, HU: 0.27, IE: 0.23, IT: 0.22, LV: 0.21, LT: 0.21, LU: 0.17,
  MT: 0.18, NL: 0.21, PL: 0.23, PT: 0.23, RO: 0.21, SK: 0.23, SI: 0.22, ES: 0.21, SE: 0.25,
};
export const FR_REDUCED_VAT_BY_CATEGORY = { Alimentation: 0.055, Livres: 0.055 };

// Rattachement utm_source → plateforme pub (attribution UTM côté Shopify, A14 : POAS sur UTM).
export const PLATFORM_UTM_SOURCES = {
  meta:       ["facebook", "fb", "instagram", "ig", "meta"],
  google_ads: ["google", "adwords", "google_ads", "googleads"],
  tiktok:     ["tiktok"],
};

export const DEFAULT_RETURN_WINDOW_DAYS = 30;   // décision 3
export const OVERSTOCK_DAYS = 60;               // au-delà : signal de surstock (10.11)
