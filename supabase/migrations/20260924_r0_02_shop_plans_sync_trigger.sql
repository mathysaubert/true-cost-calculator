-- R0-02 (S-02) — Recopie shop_plans → shop_settings (arbitrage S1 du 2026-09-24).
-- Contexte : l'écran classique (app._index.jsx, intouché jusqu'à F4-D) écrit ses réglages dans
-- shop_plans ; la sync v2, le moteur et les insights lisent shop_settings, copiée UNE fois par
-- F1-01. Ce trigger maintient la copie à chaque écriture de l'écran classique. Le nouvel écran
-- Réglages (R1) écrit shop_settings ET recopie vers shop_plans ; l'écriture de retour ne change
-- rien (IS DISTINCT FROM) et aucun trigger n'existe sur shop_settings : pas de boucle.
-- La colonne `plan` (facturation) n'est PAS dans la liste : une mise à jour d'offre ne touche pas
-- shop_settings. Idempotent (OR REPLACE, DROP TRIGGER IF EXISTS). Aucune donnée modifiée à
-- l'application : le trigger n'agit qu'aux prochaines écritures.
-- Rollback : supabase/rollback/20260924_r0_rollback.sql (trigger + fonction ; les colonnes de
-- shop_plans ci-dessous ne sont PAS retirées : elles pré-existent en prod, créées à la main).

-- Colonnes de shop_plans créées à la main en prod (aucune migration ne les porte, F1-01 les lit) :
-- documentées ici de façon idempotente, indispensables sur une base rejouée depuis zéro.
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS shopify_fee_pct        NUMERIC NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS processor_fee_pct      NUMERIC NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS processor_fixed_fee    NUMERIC NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS default_import_country TEXT    NOT NULL DEFAULT 'Chine';

CREATE OR REPLACE FUNCTION public.sync_shop_plans_to_settings()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.shop_settings (
    shop_domain, vat_regime, shipping_model, default_import_country,
    shopify_fee_pct, processor_fee_pct, processor_fixed_fee,
    profitability_threshold_pct, current_cpa, current_cpa_updated_at, updated_at
  )
  VALUES (
    NEW.shop_domain,
    COALESCE(NEW.vat_regime, 'assujetti'),
    COALESCE(NEW.shipping_model, 'dropshipping'),
    COALESCE(NEW.default_import_country, 'Chine'),
    COALESCE(NEW.shopify_fee_pct, 2.0),
    COALESCE(NEW.processor_fee_pct, 1.5),
    COALESCE(NEW.processor_fixed_fee, 0.25),
    COALESCE(NEW.profitability_threshold_pct, 0),
    NEW.current_cpa,
    NEW.current_cpa_updated_at,
    NOW()
  )
  ON CONFLICT (shop_domain) DO UPDATE
    SET vat_regime                  = EXCLUDED.vat_regime,
        shipping_model              = EXCLUDED.shipping_model,
        default_import_country      = EXCLUDED.default_import_country,
        shopify_fee_pct             = EXCLUDED.shopify_fee_pct,
        processor_fee_pct           = EXCLUDED.processor_fee_pct,
        processor_fixed_fee         = EXCLUDED.processor_fixed_fee,
        profitability_threshold_pct = EXCLUDED.profitability_threshold_pct,
        current_cpa                 = EXCLUDED.current_cpa,
        current_cpa_updated_at      = EXCLUDED.current_cpa_updated_at,
        updated_at                  = NOW()
    WHERE (public.shop_settings.vat_regime, public.shop_settings.shipping_model, public.shop_settings.default_import_country,
           public.shop_settings.shopify_fee_pct, public.shop_settings.processor_fee_pct, public.shop_settings.processor_fixed_fee,
           public.shop_settings.profitability_threshold_pct, public.shop_settings.current_cpa, public.shop_settings.current_cpa_updated_at)
          IS DISTINCT FROM
          (EXCLUDED.vat_regime, EXCLUDED.shipping_model, EXCLUDED.default_import_country,
           EXCLUDED.shopify_fee_pct, EXCLUDED.processor_fee_pct, EXCLUDED.processor_fixed_fee,
           EXCLUDED.profitability_threshold_pct, EXCLUDED.current_cpa, EXCLUDED.current_cpa_updated_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shop_plans_sync_settings ON public.shop_plans;
CREATE TRIGGER trg_shop_plans_sync_settings
  AFTER INSERT OR UPDATE OF vat_regime, shipping_model, default_import_country,
                            shopify_fee_pct, processor_fee_pct, processor_fixed_fee,
                            profitability_threshold_pct, current_cpa, current_cpa_updated_at
  ON public.shop_plans
  FOR EACH ROW EXECUTE FUNCTION public.sync_shop_plans_to_settings();
