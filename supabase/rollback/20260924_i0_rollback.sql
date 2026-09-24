-- ROLLBACK I0 — retire ce que 20260924_i0_01_decision_memory.sql ajoute, et rien d'autre.
-- Volontairement HORS de supabase/migrations/ : un `supabase db push` ne doit jamais l'appliquer.
-- Idempotent (IF EXISTS partout). Ordre : fonction d'enregistrement → tables → purge_shop rétablie
-- à sa définition F1-23 (sinon la fonction référencerait des tables absentes et échouerait à
-- l'appel). À exécuter AVANT le rollback F1 si l'on revient à l'état d'avant F1.
-- Aucune donnée des autres tables n'est touchée.

DROP FUNCTION IF EXISTS public.record_insights(TEXT, JSONB);

DROP TABLE IF EXISTS public.decision_log CASCADE;
DROP TABLE IF EXISTS public.insight_log  CASCADE;

-- purge_shop : définition F1-23 rétablie à l'identique.
CREATE OR REPLACE FUNCTION public.purge_shop(p_shop TEXT)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.manual_commissions        WHERE shop_domain = p_shop;
  DELETE FROM public.promo_code_rules          WHERE shop_domain = p_shop;
  DELETE FROM public.partners                  WHERE shop_domain = p_shop;
  DELETE FROM public.calculation_annotations   WHERE shop_domain = p_shop;
  DELETE FROM public.calculations              WHERE shop_domain = p_shop;
  DELETE FROM public.usage                     WHERE shop_domain = p_shop;
  DELETE FROM public.margin_alerts             WHERE shop_domain = p_shop;
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
$$;
