// ── Réglages (R1, arbitrages S1-S10 du 2026-09-24) — PUR : champs, analyse des formulaires, états ──
// shop_settings est la source de vérité (S1) ; les colonnes historiques sont recopiées vers
// shop_plans par le serveur (MIRROR_COLUMNS). Jamais un chiffre non confirmé pré-rempli (S6) :
// les valeurs courantes servent de placeholders, une règle n'existe qu'après « Confirmer ».

export const SETTINGS_NAV = [
  { id: "index",       path: "/app/settings",       status: "live" },
  { id: "costs",       path: "/app/settings/costs", status: "live" },
  { id: "products",    path: "/app/settings/products", status: "live" },
  { id: "goals",       path: "/app/settings/goals", status: "live" },
  { id: "shop",        path: "/app/settings/shop",        status: "live" },
  { id: "marketing",   path: "/app/settings/marketing",   status: "live" },
  { id: "connections", path: "/app/settings/connections", status: "live" },
  { id: "plan",        path: "/app/settings/plan",        status: "live" },
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
  // Règle « non renseigné » (2026-09-25) : un port par défaut vide reste NULL, jamais 0 € ; le moteur
  // compte alors le port facturé au client, signalé « à confirmer ». 0 saisi = vrai choix de 0 €.
  // Confirmé seulement si le marchand a saisi quelque chose (défaut ou surcharge par pays).
  const dflt = def == null || def === undefined ? null : Math.round(def * 100) / 100;
  const rules = { default: dflt, byCountry, confirmed: dflt != null || Object.keys(byCountry).length > 0 };
  return { rules, errors };
}

// État du port marchand : set (défaut confirmé : toutes les commandes couvertes) ; unconfirmed
// (surcharges par pays seules, ou règle non confirmée : le reste retombe sur le port facturé) ; unset.
export function shippingState(rules = {}) {
  const sr = rules ?? {};
  const hasDefault = sr.default != null, hasCountries = Object.keys(sr.byCountry ?? {}).length > 0;
  if (sr.confirmed === true && hasDefault) return "set";
  if (hasDefault || hasCountries) return "unconfirmed";
  return "unset";
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
export function settingsStatus({ settings = {}, fixedCosts = [], gateways = [], day = null, partners = [], promoRules = [], connections = [] } = {}) {
  const rules = Array.isArray(settings.gateway_fee_rules) ? settings.gateway_fee_rules : [];
  const confirmedGw = gateways.filter((g) => ruleFor(rules, g.gateway)?.confirmed);
  const gwState = !gateways.length ? (rules.some((r) => r?.confirmed) ? "set" : "unset") : confirmedGw.length === gateways.length ? "set" : confirmedGw.length ? "unconfirmed" : "unset";
  const sr = settings.shipping_cost_rules ?? {};
  const active = day ? fixedCosts.filter((r) => isActiveFixedCost(r, day)) : fixedCosts;
  const st = (id, page, state) => ({ id, page, state });
  const conn = Array.isArray(connections) ? connections : [];
  return [
    st("shop_country", "shop", settings.shop_country_code ? "set" : "unset"),
    st("sales_countries", "shop", Array.isArray(settings.sales_countries) && settings.sales_countries.length ? "set" : "unset"),
    st("partners", "marketing", partners.length ? "set" : "unset"),
    st("promo_rules", "marketing", promoRules.length ? "set" : "unset"),
    st("ads_connection", "connections", conn.some((c) => c.status === "connected") ? "set" : conn.some((c) => c.status === "error" || c.status === "revoked") ? "unconfirmed" : "unset"),
    st("gateway_fees", "costs", gwState),
    st("shipping", "costs", shippingState(sr)),
    st("packaging", "costs", settings.packaging_cost_per_order != null ? "set" : "unset"),
    st("return_cost", "costs", settings.return_cost_per_return != null ? "set" : "unset"),
    st("fixed_costs", "costs", active.length ? "set" : "unset"),
    st("cm2_target", "goals", Number(settings.profitability_threshold_pct) > 0 ? "set" : "unset"),
    st("roas_target", "goals", settings.target_margin_after_ads_pct != null ? "set" : "unset"),
    st("main_product_price", "goals", settings.main_product_price != null ? "set" : "unset"),
  ];
}

// ── R2 : Boutique (S8), Marketing (décision H), Connexions ────────────────────────────────────
import { VAT_REGIMES } from "./variantCosts.js";
import { SUPPORTED_LOCALES } from "./i18n/resolveLocale.js";

export const LOCALE_CHOICES = SUPPORTED_LOCALES;
export const COUNTRY_LIST_FIELDS = ["sales_countries", "shipping_countries", "supply_countries"];
export const SHOP_FIELDS = [
  { key: "shop_country_code", kind: "country" },
  { key: "vat_regime", kind: "enum", values: VAT_REGIMES, mirror: true },
  { key: "b2b_tag", kind: "text", max: 60 },
  { key: "history_months", kind: "int", min: 1, max: 60, placeholder: 24 },
  { key: "locale_override", kind: "locale" },
  { key: "report_locale", kind: "locale" },
];
export const PARTNER_MODES = ["codes", "manual"];
export const COMMISSION_BASES = ["ht_after_discount", "ht_before_discount"];
export const PROVIDERS = ["meta", "google_ads", "tiktok", "search_console"];
const ISO2 = /^[A-Z]{2}$/;
const str = (v) => String(v ?? "").trim();

// Liste de pays « FR, DE, us » → ["FR","DE","US"] ; vide → null ; code invalide → undefined.
export function parseCountryList(raw) {
  const s = str(raw);
  if (!s) return null;
  const codes = [...new Set(s.split(/[\s,;]+/).filter(Boolean).map((c) => c.toUpperCase()))];
  return codes.every((c) => ISO2.test(c)) ? codes : undefined;
}

export function parseShopForm(form) {
  const values = {}, errors = {};
  for (const f of SHOP_FIELDS) {
    const raw = form.get(f.key);
    if (raw == null) continue;
    const s = str(raw);
    if (f.kind === "country") { if (!s) values[f.key] = null; else if (ISO2.test(s.toUpperCase())) values[f.key] = s.toUpperCase(); else errors[f.key] = "invalid"; }
    else if (f.kind === "enum") { if (f.values.includes(s)) values[f.key] = s; else errors[f.key] = "invalid"; }
    else if (f.kind === "text") { values[f.key] = s ? s.slice(0, f.max).toLowerCase() : null; }
    else if (f.kind === "int") { const n = parseNumber(s); if (n === undefined || (n != null && !Number.isInteger(n))) errors[f.key] = "invalid"; else if (n != null && (n < f.min || n > f.max)) errors[f.key] = "range"; else values[f.key] = n; }
    else if (f.kind === "locale") { if (!s) values[f.key] = null; else if (LOCALE_CHOICES.includes(s)) values[f.key] = s; else errors[f.key] = "invalid"; }
  }
  for (const k of COUNTRY_LIST_FIELDS) {
    const raw = form.get(k);
    if (raw == null) continue;
    const v = parseCountryList(raw);
    if (v === undefined) errors[k] = "invalid"; else values[k] = v;
  }
  if (values.history_months === null) delete values.history_months; // colonne NOT NULL : vide = inchangé
  return { values, errors };
}

export function partnerFromForm(form) {
  const errors = {};
  const name = str(form.get("name")).slice(0, 80);
  if (!name) errors.name = "invalid";
  const mode = str(form.get("mode")) || "codes";
  if (!PARTNER_MODES.includes(mode)) errors.mode = "invalid";
  return { row: { name, mode }, errors };
}

const isoDay = (v) => { const s = str(v); if (!s) return null; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined; };

export function promoRuleFromForm(form, partners = []) {
  const errors = {};
  const code = str(form.get("code")).toUpperCase().slice(0, 60);
  if (!code) errors.code = "invalid";
  const partnerId = str(form.get("partner_id")) || null;
  if (partnerId && !partners.some((p) => p.id === partnerId)) errors.partner_id = "invalid";
  const pct = parseNumber(form.get("commission_pct"));
  if (pct === undefined || pct == null) errors.commission_pct = "invalid"; else if (pct < 0 || pct > 100) errors.commission_pct = "range";
  const base = str(form.get("commission_base")) || "ht_after_discount";
  if (!COMMISSION_BASES.includes(base)) errors.commission_base = "invalid";
  const from = isoDay(form.get("active_from")), to = isoDay(form.get("active_to"));
  if (from === undefined) errors.active_from = "invalid";
  if (to === undefined) errors.active_to = "invalid";
  if (from && to && to < from) errors.active_to = "range";
  return { row: { code, partner_id: partnerId, commission_pct: pct == null ? null : Math.round(pct * 10000) / 10000, commission_base: base, active_from: from ?? null, active_to: to ?? null }, errors };
}

export function manualCommissionFromForm(form, partners = []) {
  const errors = {};
  const partnerId = str(form.get("partner_id"));
  if (!partnerId || !partners.some((p) => p.id === partnerId && p.mode === "manual")) errors.partner_id = "invalid";
  const period = str(form.get("period_month"));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) errors.period_month = "invalid";
  const amount = parseNumber(form.get("amount"));
  if (amount === undefined || amount == null) errors.amount = "invalid"; else if (amount < 0 || amount > 10000000) errors.amount = "range";
  const note = str(form.get("note")).slice(0, 200) || null;
  return { row: { partner_id: partnerId, period_month: period, amount: amount == null ? null : Math.round(amount * 100) / 100, note }, errors };
}

// Codes promo vus dans les commandes (orders.discount_codes), comptés et triés.
export function codesFromOrders(rows = []) {
  const counts = new Map();
  for (const r of rows) for (const c of r?.discount_codes ?? []) { const k = str(c).toUpperCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); }
  return [...counts.entries()].map(([code, orders]) => ({ code, orders })).sort((a, b) => b.orders - a.orders || a.code.localeCompare(b.code));
}

// État des connexions : Shopify (la synchronisation) + un fournisseur par ligne, connecté ou non.
export function connectionsStatus({ rows = [], lastSync = null, now = null } = {}) {
  const staleMs = 3 * 86_400_000;
  const shopifyStatus = !lastSync ? "none" : now && Date.parse(now) - Date.parse(lastSync) > staleMs ? "stale" : "connected";
  const out = [{ id: "shopify", status: shopifyStatus, account: null, last_sync_at: lastSync, last_error: null }];
  for (const p of PROVIDERS) {
    const r = rows.find((x) => x?.provider === p);
    out.push({ id: p, status: r?.status ?? "none", account: r?.external_account_name ?? null, last_sync_at: r?.last_sync_at ?? null, last_error: r?.last_error ?? null });
  }
  return out;
}
