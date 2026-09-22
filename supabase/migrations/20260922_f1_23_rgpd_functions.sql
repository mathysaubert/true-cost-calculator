-- F1-23 — RGPD : une seule source de vérité côté base pour la purge boutique et l'effacement client.
-- purge_shop : vide TOUTES les tables porteuses de shop_domain (purge totale, décision g) — les 12
-- tables historiques ET les nouvelles. Seule fx_rates (référentiel partagé, sans boutique) est hors
-- purge. Les deux webhooks (app/uninstalled, shop/redact) appellent cette fonction par RPC ; la liste
-- JS (app/lib/schema.js) sert de repli et le lot23 vérifie que les deux listes coïncident.
-- Ordre : enfants avant parents (manual_commissions → partners ; calculation_annotations est en
-- CASCADE sur calculations). SECURITY INVOKER : seul le service role (bypass RLS) l'appelle.
-- Les tables calculations / calculation_annotations / margin_alerts seront supprimées avec le code
-- qui les lit (F4) : cette fonction sera alors remplacée (CREATE OR REPLACE) sans ces lignes.
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

-- customers/redact : le client disparaît des agrégats et les commandes perdent son identifiant
-- (les montants de vente restent, non nominatifs). p_customer_id = gid brut (décision b).
CREATE OR REPLACE FUNCTION public.redact_customer(p_shop TEXT, p_customer_id TEXT)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.customers_agg WHERE shop_domain = p_shop AND customer_id = p_customer_id;
  UPDATE public.orders
     SET customer_id = NULL, customer_order_index = NULL, updated_at = NOW()
   WHERE shop_domain = p_shop AND customer_id = p_customer_id;
$$;
