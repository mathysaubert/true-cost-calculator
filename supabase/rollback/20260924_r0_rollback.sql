-- ROLLBACK R0 — retire ce que 20260924_r0_01 et 20260924_r0_02 ajoutent, et rien d'autre.
-- Volontairement HORS de supabase/migrations/. Idempotent (IF EXISTS partout). Aucune donnée des
-- autres colonnes touchée. Indépendant des rollbacks I0 et F1 (ordre libre ; le rollback F1
-- supprime shop_settings entière, colonnes R0 comprises).
--
-- EXCEPTION ASSUMÉE : les colonnes shop_plans.shopify_fee_pct / processor_fee_pct /
-- processor_fixed_fee / default_import_country ne sont PAS retirées : elles pré-existent en prod
-- (créées à la main) et l'écran classique les écrit ; R0-02 ne fait que les documenter.

-- 1. Trigger et fonction de recopie (R0-02)
DROP TRIGGER IF EXISTS trg_shop_plans_sync_settings ON public.shop_plans;
DROP FUNCTION IF EXISTS public.sync_shop_plans_to_settings();

-- 2. Colonnes ajoutées à shop_settings (R0-01) — nullables, jamais pré-remplies : aucune perte
ALTER TABLE IF EXISTS public.shop_settings
  DROP COLUMN IF EXISTS main_product_price,
  DROP COLUMN IF EXISTS sales_countries,
  DROP COLUMN IF EXISTS shipping_countries,
  DROP COLUMN IF EXISTS supply_countries,
  DROP COLUMN IF EXISTS report_locale;
