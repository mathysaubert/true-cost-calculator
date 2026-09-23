-- ROLLBACK F1 — retire TOUT ce que les migrations 20260922_f1_01 → 23 ajoutent.
-- Volontairement HORS de supabase/migrations/ : un `supabase db push` ne doit jamais l'appliquer.
-- Idempotent (IF EXISTS partout) : ré-exécutable sans erreur sur une base déjà revenue en arrière.
-- Ordre : fonctions → tables (CASCADE pour les FK manual_commissions/promo_code_rules → partners)
-- → colonnes ajoutées aux tables historiques → index ajoutés aux tables historiques.
-- Les tables historiques et leurs données sont INTACTES : F1 n'a fait que COPIER dans
-- shop_settings / sync_jobs / alert_state (supprimées ici), jamais déplacer ni modifier.
--
-- EXCEPTION ASSUMÉE : shop_plans.shipping_model n'est PAS retirée. F1-01 l'ajoute de façon
-- idempotente parce qu'elle pré-existe en prod (créée à la main, hors migrations) et que le code
-- en production l'écrit (set_shipping_model) : la retirer casserait l'app. Sur une base rejouée
-- depuis zéro elle reste donc après rollback, sans effet (colonne nullable avec défaut).

-- 0. Addendum F3 (F1-24) : colonnes de réglages ajoutées à shop_settings — retirées AVANT la table
--    (sans effet si la table est ensuite supprimée, mais le rollback reste correct si l'addendum
--    est appliqué seul sur une base où F1 est conservée).
ALTER TABLE IF EXISTS public.shop_settings
  DROP COLUMN IF EXISTS shipping_cost_rules,
  DROP COLUMN IF EXISTS packaging_cost_per_order,
  DROP COLUMN IF EXISTS return_cost_per_return,
  DROP COLUMN IF EXISTS shop_country_code;

-- 0b. Addendum F4 (20260923_f4_01) : réglage boutique de développement — retiré de même.
ALTER TABLE IF EXISTS public.shop_settings
  DROP COLUMN IF EXISTS is_dev_shop,
  DROP COLUMN IF EXISTS include_test_orders;

-- 1. Fonctions RGPD (F1-23)
DROP FUNCTION IF EXISTS public.redact_customer(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.purge_shop(TEXT);

-- 2. Tables créées par F1 (F1-01, 02, 04 → 12, 14 → 22)
DROP TABLE IF EXISTS public.ai_explanations          CASCADE;
DROP TABLE IF EXISTS public.alert_state              CASCADE;
DROP TABLE IF EXISTS public.alert_rules              CASCADE;
DROP TABLE IF EXISTS public.customers_agg            CASCADE;
DROP TABLE IF EXISTS public.product_daily_rollups    CASCADE;
DROP TABLE IF EXISTS public.daily_rollups            CASCADE;
DROP TABLE IF EXISTS public.webhook_events           CASCADE;
DROP TABLE IF EXISTS public.sync_jobs                CASCADE;
DROP TABLE IF EXISTS public.integration_connections  CASCADE;
DROP TABLE IF EXISTS public.fixed_costs              CASCADE;
DROP TABLE IF EXISTS public.manual_commissions       CASCADE;
DROP TABLE IF EXISTS public.promo_code_rules         CASCADE;
DROP TABLE IF EXISTS public.partners                 CASCADE;
DROP TABLE IF EXISTS public.fx_rates                 CASCADE;
DROP TABLE IF EXISTS public.seo_index_status         CASCADE;
DROP TABLE IF EXISTS public.seo_daily                CASCADE;
DROP TABLE IF EXISTS public.ad_entities              CASCADE;
DROP TABLE IF EXISTS public.ad_spend                 CASCADE;
DROP TABLE IF EXISTS public.sessions_daily           CASCADE;
DROP TABLE IF EXISTS public.inventory_daily          CASCADE;
DROP TABLE IF EXISTS public.order_fees               CASCADE;
DROP TABLE IF EXISTS public.fulfillments             CASCADE;
DROP TABLE IF EXISTS public.returns                  CASCADE;
DROP TABLE IF EXISTS public.refunds                  CASCADE;
DROP TABLE IF EXISTS public.orders                   CASCADE;
DROP TABLE IF EXISTS public.shop_settings            CASCADE;

-- 3. Colonnes ajoutées à order_margins (F1-03) — nullables, jamais remplies avant F2 : aucune perte.
ALTER TABLE public.order_margins
  DROP COLUMN IF EXISTS unit_price_ht,
  DROP COLUMN IF EXISTS tax_lines,
  DROP COLUMN IF EXISTS is_gift_card,
  DROP COLUMN IF EXISTS cm1_components,
  DROP COLUMN IF EXISTS cm1_unit,
  DROP COLUMN IF EXISTS cm2_alloc,
  DROP COLUMN IF EXISTS breakdown_version,
  DROP COLUMN IF EXISTS day_local;
DROP INDEX IF EXISTS public.idx_order_margins_shop_product;
DROP INDEX IF EXISTS public.idx_order_margins_shop_day;

-- 4. Colonnes ajoutées à variant_costs (F1-13)
ALTER TABLE public.variant_costs
  DROP COLUMN IF EXISTS supplier_lead_days,
  DROP COLUMN IF EXISTS buffer_days,
  DROP COLUMN IF EXISTS duty_rate_pct,
  DROP COLUMN IF EXISTS landed_cost_override;
DROP INDEX IF EXISTS public.idx_variant_costs_shop_product;
