-- D2-4 (2026-09-26) — Retrait en base de l'écran classique (supprimé du code en D2-3) et objectif de
-- marge « non renseigné ». Arbitrages X9, X10 et rappel 4 de la Phase 0 de D2 (décisions §L, §N).
-- Appliquée en UNE transaction (psql --single-transaction, ON_ERROR_STOP) : tout ou rien.
-- Retour arrière : généré depuis la base elle-même juste avant l'application (scripts/d2_4_migrate.mjs,
-- mode prepare : pg_dump des tables retirées, définitions de fonctions et du déclencheur, colonnes et
-- valeurs retirées de shop_plans, valeurs de l'objectif), gardé hors dépôt avec la sauvegarde de la base.
-- Ordre imposé : purge_shop d'abord (sinon la désinstallation et le RGPD échoueraient sur des tables
-- absentes), puis déclencheur, tables, colonnes, objectif.

-- 1. purge_shop sans les tables de l'écran classique (même ordre que la définition I0, moins 3 lignes)
CREATE OR REPLACE FUNCTION public.purge_shop(p_shop TEXT)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.manual_commissions        WHERE shop_domain = p_shop;
  DELETE FROM public.promo_code_rules          WHERE shop_domain = p_shop;
  DELETE FROM public.partners                  WHERE shop_domain = p_shop;
  DELETE FROM public.usage                     WHERE shop_domain = p_shop;
  DELETE FROM public.rate_limits               WHERE shop_domain = p_shop;
  DELETE FROM public.product_profitability_state WHERE shop_domain = p_shop;
  DELETE FROM public.subscription_dunning_state WHERE shop_domain = p_shop;
  DELETE FROM public.session_health            WHERE shop_domain = p_shop;
  DELETE FROM public.variant_costs             WHERE shop_domain = p_shop;
  DELETE FROM public.order_margins             WHERE shop_domain = p_shop;
  DELETE FROM public.order_sync_state          WHERE shop_domain = p_shop;
  DELETE FROM public.shop_plans                WHERE shop_domain = p_shop;
  DELETE FROM public.shop_settings             WHERE shop_domain = p_shop;
  DELETE FROM public.orders                    WHERE shop_domain = p_shop;
  DELETE FROM public.refunds                   WHERE shop_domain = p_shop;
  DELETE FROM public.returns                   WHERE shop_domain = p_shop;
  DELETE FROM public.fulfillments              WHERE shop_domain = p_shop;
  DELETE FROM public.order_fees                WHERE shop_domain = p_shop;
  DELETE FROM public.inventory_daily           WHERE shop_domain = p_shop;
  DELETE FROM public.sessions_daily            WHERE shop_domain = p_shop;
  DELETE FROM public.ad_spend                  WHERE shop_domain = p_shop;
  DELETE FROM public.ad_entities               WHERE shop_domain = p_shop;
  DELETE FROM public.seo_daily                 WHERE shop_domain = p_shop;
  DELETE FROM public.seo_index_status          WHERE shop_domain = p_shop;
  DELETE FROM public.fixed_costs               WHERE shop_domain = p_shop;
  DELETE FROM public.integration_connections   WHERE shop_domain = p_shop;
  DELETE FROM public.sync_jobs                 WHERE shop_domain = p_shop;
  DELETE FROM public.webhook_events            WHERE shop_domain = p_shop;
  DELETE FROM public.daily_rollups             WHERE shop_domain = p_shop;
  DELETE FROM public.product_daily_rollups     WHERE shop_domain = p_shop;
  DELETE FROM public.customers_agg             WHERE shop_domain = p_shop;
  DELETE FROM public.alert_rules               WHERE shop_domain = p_shop;
  DELETE FROM public.alert_state               WHERE shop_domain = p_shop;
  DELETE FROM public.ai_explanations           WHERE shop_domain = p_shop;
  DELETE FROM public.insight_log               WHERE shop_domain = p_shop;
  DELETE FROM public.decision_log              WHERE shop_domain = p_shop;
$$;

-- 2. Recopie shop_plans → shop_settings (R0-02) : plus aucun écrivain de shop_plans pour les réglages
DROP TRIGGER IF EXISTS trg_shop_plans_sync_settings ON public.shop_plans;
DROP FUNCTION IF EXISTS public.sync_shop_plans_to_settings();

-- 3. Tables de l'écran classique (calculateur, annotations, seuil d'alerte des calculs) — X9, X10
DROP TABLE IF EXISTS public.calculation_annotations;
DROP TABLE IF EXISTS public.calculations;
DROP TABLE IF EXISTS public.margin_alerts;

-- 4. Colonnes de réglages de shop_plans (source de vérité : shop_settings) ; on garde plan (cache de l'offre)
ALTER TABLE public.shop_plans
  DROP COLUMN IF EXISTS vat_regime,
  DROP COLUMN IF EXISTS shipping_model,
  DROP COLUMN IF EXISTS default_import_country,
  DROP COLUMN IF EXISTS shopify_fee_pct,
  DROP COLUMN IF EXISTS processor_fee_pct,
  DROP COLUMN IF EXISTS processor_fixed_fee,
  DROP COLUMN IF EXISTS profitability_threshold_pct,
  DROP COLUMN IF EXISTS current_cpa,
  DROP COLUMN IF EXISTS current_cpa_updated_at;

-- 5. Objectif de marge CM2 « non renseigné » (rappel 4) : facultatif, sans défaut ; les 0 jamais choisis
--    (valeur par défaut de la colonne) deviennent NULL. Un objectif choisi (> 0) est gardé tel quel.
ALTER TABLE public.shop_settings ALTER COLUMN profitability_threshold_pct DROP NOT NULL;
ALTER TABLE public.shop_settings ALTER COLUMN profitability_threshold_pct DROP DEFAULT;
UPDATE public.shop_settings SET profitability_threshold_pct = NULL WHERE profitability_threshold_pct = 0;
