// ── Réglages (R1, arbitrages S1-S10 du 2026-09-24) — PUR : champs, analyse des formulaires, états ──
// shop_settings est la source de vérité (S1) ; les colonnes historiques sont recopiées vers
// shop_plans par le serveur (MIRROR_COLUMNS). Jamais un chiffre non confirmé pré-rempli (S6) :
// les valeurs courantes servent de placeholders, une règle n'existe qu'après « Confirmer ».

export const SETTINGS_NAV = [
  { id: "index",       path: "/app/settings",       status: "live" },
  { id: "costs",       path: "/app/settings/costs", status: "live" },
  { id: "goals",       path: "/app/settings/goals", status: "live" },
  { id: "shop",        path: null, status: "soon" },
  { id: "marketing",   path: null, status: "soon" },
  { id: "connections", path: null, status: "soon" },
];

// Champs scalaires par formulaire : colonne shop_settings, unité, bornes. `mirror` = recopié vers shop_plans.
export const FIELDS = {
  order_costs: [
    { key: "packaging_cost_per_order", kind: "money", min: 0, max: 1000 },
    { key: "return_cost_per_return",   kind: "money", min: 0, max: 10000 },
    { key: "return_window_days",       kind: "int",   min: 0, max: 365 },
    { key: "delivery_promise_days",    kind: "int",   min: 0, max: 60 },
  ],
  goals: [
    { key: "profitability_threshold_pct", kind: "pct",   min: 0, max: 100, mirror: true },
    { key: "target_margin_after_ads_pct", kind: "pct",   min: 0, max: 100 },
    { key: "main_product_price",          kind: "money", min: 0, max: 1000000 },
  ],
};
export const MIRROR_COLUMNS = ["vat_regime", "shipping_model", "default_import_country", "shopify_fee_pct", "processor_fee_pct", "processor_fixed_fee", "profitability_threshold_pct"];
export const SHIPPING_ROWS = 5;
export const CM2_TARGET_BAND = { low: 40, high: 60 }; // rappel A12

// Valeurs courantes par passerelle (placeholders, jamais enregistrées sans confirmation).
export const GATEWAY_PRESETS = [
  { match: /shopify_payments|shopify payments/i, pct: 1.5, fixed: 0.25 },
  { match: /paypal/i,                             pct: 3.4, fixed: 0.35 },
  { match: /stripe/i,                             pct: 1.5, fixed: 0.25 },
  { match: /manual|bank|cash|cod|bogus|gift/i,     pct: 0,   fixed: 0 },
];
export const presetFor = (gateway) => GATEWAY_PRESETS.find((p) => p.match.test(String(gateway ?? ""))) ?? { pct: 2.0, fixed: 0.25 };

// "" → null ; "1 234,5" → 1234.5 (espaces fines comprises, NFKC) ; texte → undefined (invalide).
export function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).normalize("NFKC").replace(/\s/g, "").replace(",", ".").trim();
  if (s === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}

// Champs scalaires : { values, errors } ; une valeur vide efface (NULL), jamais un défaut inventé.
export function parseFields(fields, form) {
  const values = {}, errors = {};
  for (const f of fields) {
    const raw = form.get(f.key);
    if (raw == null) continue;
    const n = parseNumber(raw);
    if (n === undefined) { errors[f.key] = "invalid"; continue; }
    if (n == null) { values[f.key] = null; continue; }
    if (f.kind === "int" && !Number.isInteger(n)) { errors[f.key] = "invalid"; continue; }
    if (n < f.min || n > f.max) { errors[f.key] = "range"; continue; }
    values[f.key] = f.kind === "money" ? Math.round(n * 100) / 100 : n;
  }
  return { values, errors };
}

// Port marchand par pays (A3) : shipping_default + (shipping_country_N, shipping_amount_N). Confirmé à la sauvegarde.
export function shippingRulesFromForm(form) {
  const errors = {};
  const def = parseNumber(form.get("shipping_default"));
  if (def === undefined) errors.shipping_default = "invalid";
  else if (def != null && (def < 0 || def > 10000)) errors.shipping_default = "range";
  const byCountry = {};
  for (let i = 1; i <= SHIPPING_ROWS; i++) {
    const c = String(form.get(`shipping_country_${i}`) ?? "").trim().toUpperCase();
    const a = parseNumber(form.get(`shipping_amount_${i}`));
    if (!c && a == null) continue;
    if (!/^[A-Z]{2}$/.test(c)) { errors[`shipping_country_${i}`] = "invalid"; continue; }
    if (a === undefined || a == null) { errors[`shipping_amount_${i}`] = "invalid"; continue; }
    if (a < 0 || a > 10000) { errors[`shipping_amount_${i}`] = "range"; continue; }
    byCountry[c] = Math.round(a * 100) / 100;
  }
  const rules = { default: def == null ? 0 : Math.round(def * 100) / 100, byCountry, confirmed: true };
  return { rules, errors };
}

// Règle de frais d'une passerelle (S4) : une sauvegarde = une confirmation.
export function gatewayRuleFromForm(form) {
  const errors = {};
  const gateway = String(form.get("gateway") ?? "").trim();
  if (!gateway) errors.gateway = "invalid";
  const pct = parseNumber(form.get("pct")), fixed = parseNumber(form.get("fixed"));
  if (pct === undefined || pct == null) errors.pct = "invalid"; else if (pct < 0 || pct > 20) errors.pct = "range";
  if (fixed === undefined || fixed == null) errors.fixed = "invalid"; else if (fixed < 0 || fixed > 10) errors.fixed = "range";
  return { rule: { gateway, pct: pct ?? null, fixed: fixed ?? null, confirmed: true }, errors };
}
export function mergeGatewayRule(rules = [], rule) {
  const list = Array.isArray(rules) ? rules.filter((r) => r && r.gateway !== rule.gateway) : [];
  return [...list, rule].sort((a, b) => String(a.gateway).localeCompare(String(b.gateway)));
}
export const ruleFor = (rules = [], gateway) => (Array.isArray(rules) ? rules.find((r) => r?.gateway === gateway) ?? null : null);

// Passerelles vues dans les commandes (orders.gateway_names), par nombre de commandes décroissant.
export function gatewaysFromOrders(rows = []) {
  const counts = new Map();
  for (const r of rows) for (const g of r?.gateway_names ?? []) if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()].map(([gateway, orders]) => ({ gateway, orders })).sort((a, b) => b.orders - a.orders || a.gateway.localeCompare(b.gateway));
}

// Coût fixe (A6) : libellé libre, montant mensuel, actif du / au (dates ISO ou vides).
export function fixedCostFromForm(form) {
  const errors = {};
  const label = String(form.get("label") ?? "").trim().slice(0, 120);
  if (!label) errors.label = "invalid";
  const amount = parseNumber(form.get("amount_monthly"));
  if (amount === undefined || amount == null) errors.amount_monthly = "invalid"; else if (amount < 0 || amount > 10000000) errors.amount_monthly = "range";
  const day = (v) => { const s = String(v ?? "").trim(); if (!s) return null; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; };
  const from = day(form.get("active_from")), to = day(form.get("active_to"));
  if (from === undefined) errors.active_from = "invalid";
  if (to === undefined) errors.active_to = "invalid";
  if (from && to && to < from) errors.active_to = "range";
  return { row: { label, amount_monthly: amount == null ? null : Math.round(amount * 100) / 100, active_from: from ?? null, active_to: to ?? null }, errors };
}
export const isActiveFixedCost = (r, day) => (!r.active_from || r.active_from <= day) && (!r.active_to || r.active_to >= day);

// Sous-ensemble recopié vers shop_plans (S1a).
export function mirrorFor(values = {}) {
  return Object.fromEntries(Object.entries(values).filter(([k]) => MIRROR_COLUMNS.includes(k)));
}

// Règle de fiabilité touchée par une sauvegarde (S10 : decision_log data_fixed explicite).
export function dataRuleOf(intent) {
  return { save_gateway: "payment_fees", save_shipping: "shipping_costs", save_order_costs: "shipping_costs", add_fixed_cost: "fixed_costs", end_fixed_cost: "fixed_costs", delete_fixed_cost: "fixed_costs" }[intent] ?? null;
}

// État des réglages pour la page d'accueil : set | unset | unconfirmed, avec la page qui le porte.
export function settingsStatus({ settings = {}, fixedCosts = [], gateways = [], day = null } = {}) {
  const rules = Array.isArray(settings.gateway_fee_rules) ? settings.gateway_fee_rules : [];
  const confirmedGw = gateways.filter((g) => ruleFor(rules, g.gateway)?.confirmed);
  const gwState = !gateways.length ? (rules.some((r) => r?.confirmed) ? "set" : "unset") : confirmedGw.length === gateways.length ? "set" : confirmedGw.length ? "unconfirmed" : "unset";
  const sr = settings.shipping_cost_rules ?? {};
  const active = day ? fixedCosts.filter((r) => isActiveFixedCost(r, day)) : fixedCosts;
  const st = (id, page, state) => ({ id, page, state });
  return [
    st("gateway_fees", "costs", gwState),
    st("shipping", "costs", sr.confirmed ? "set" : "unset"),
    st("packaging", "costs", settings.packaging_cost_per_order != null ? "set" : "unset"),
    st("return_cost", "costs", settings.return_cost_per_return != null ? "set" : "unset"),
    st("fixed_costs", "costs", active.length ? "set" : "unset"),
    st("cm2_target", "goals", Number(settings.profitability_threshold_pct) > 0 ? "set" : "unset"),
    st("roas_target", "goals", settings.target_margin_after_ads_pct != null ? "set" : "unset"),
    st("main_product_price", "goals", settings.main_product_price != null ? "set" : "unset"),
  ];
}
