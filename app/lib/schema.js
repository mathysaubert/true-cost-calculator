// ── Contrat de schéma — PUR (aucun I/O). Une seule liste JS des tables Supabase de l'app.
// Consommée par : les webhooks RGPD (repli si la RPC purge_shop est absente), le lot23 (qui vérifie
// que cette liste = les tables créées par les migrations = les tables vidées par purge_shop) et,
// plus tard, l'export data_request. Toute nouvelle migration qui crée une table DOIT l'ajouter ici,
// sinon le lot23 rougit — c'est le garde-fou contre une table oubliée par la purge.

// Tables historiques (avant la refonte) encore présentes : calculations, calculation_annotations et
// margin_alerts ont été retirées en D2-4 (20260926_d2_01_drop_legacy.sql).
export const LEGACY_TABLES = [
  "usage",
  "rate_limits",
  "shop_plans",
  "variant_costs",
  "order_margins",
  "order_sync_state",
  "product_profitability_state",
  "subscription_dunning_state",
  "session_health",
];

// Tables créées par F1 (migrations 20260922_f1_*).
export const F1_TABLES = [
  "shop_settings",
  "orders",
  "refunds",
  "returns",
  "fulfillments",
  "order_fees",
  "inventory_daily",
  "sessions_daily",
  "ad_spend",
  "ad_entities",
  "seo_daily",
  "seo_index_status",
  "fx_rates",
  "partners",
  "promo_code_rules",
  "manual_commissions",
  "fixed_costs",
  "integration_connections",
  "sync_jobs",
  "webhook_events",
  "daily_rollups",
  "product_daily_rollups",
  "customers_agg",
  "alert_rules",
  "alert_state",
  "ai_explanations",
];

// Tables créées par I0 (migrations 20260924_i0_*) : mémoire des décisions (D7a). Non nominatives.
export const I0_TABLES = ["insight_log", "decision_log"];

// Natures d'une décision (CHECK SQL de decision_log.kind = cette liste, vérifié par les lots 23 et 28).
export const DECISION_KINDS = ["simulated", "accepted", "dismissed", "data_fixed", "action_started", "action_done"];

export const ALL_TABLES = [...LEGACY_TABLES, ...F1_TABLES, ...I0_TABLES];

// Tables supprimées par une migration (D2-4) : le lot23 les retire des tables créées par les migrations.
export const DROPPED_TABLES = ["calculations", "calculation_annotations", "margin_alerts"];

// Référentiels partagés SANS shop_domain : hors purge boutique (décision g : tout le reste est purgé).
export const SHARED_REFERENCE_TABLES = ["fx_rates"];

// Purge totale à la désinstallation / shop_redact. Enfants avant parents (FK) : l'ordre compte.
const CHILDREN_FIRST = ["manual_commissions", "promo_code_rules", "partners"];
export const PURGE_TABLES = [
  ...CHILDREN_FIRST,
  ...ALL_TABLES.filter((t) => !CHILDREN_FIRST.includes(t) && !SHARED_REFERENCE_TABLES.includes(t)),
];

// order_margins : clé d'idempotence (ON CONFLICT DO NOTHING) et colonnes de SNAPSHOT — figées à
// l'ingestion, jamais réécrites par une ré-ingestion. F1 ajoute les 4 dernières (nullables, sans
// DEFAULT) ; le lot23 vérifie qu'aucune migration ne pose de DEFAULT non nul sur ces colonnes.
export const ORDER_MARGINS_KEY = ["shop_domain", "order_id", "line_item_id"];
export const ORDER_MARGINS_SNAPSHOT_COLUMNS = [
  "net_unit_revenue",
  "unit_net_margin",
  "line_net_margin",
  "line_net_revenue",
  "allocated_fixed_fee",
  "cost_source",
  "cost_snapshot_json",
  "margin_breakdown_json",
  "unit_price_ht",
  "tax_lines",
  "cm1_components",
  "cm1_unit",
  "cm2_alloc",
];

// Colonnes de FAITS mutables d'order_margins (quantités remboursées) : les seules que la sync v2
// (F2) a le droit de mettre à jour après l'insertion — jamais une colonne de snapshot (lot25).
export const ORDER_MARGINS_MUTABLE_COLUMNS = ["refunded_qty", "effective_qty"];

// Valeurs d'exclusion d'une commande (brief §9) — miroir du CHECK de orders.excluded_reason.
export const ORDER_EXCLUSION_REASONS = ["test", "cancelled", "gift_card_only", "draft", "b2b"];
