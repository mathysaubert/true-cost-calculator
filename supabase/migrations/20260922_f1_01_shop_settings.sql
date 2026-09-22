-- F1-01 — Réglages boutique : scission de shop_plans (facturation) et des réglages métier.
-- shop_plans garde plan/updated_at (facturation, hors périmètre refonte). Les colonnes de
-- réglages qu'elle porte encore sont COPIÉES ici, pas supprimées : le code en production les lit
-- toujours ; leur suppression viendra avec le code qui bascule (F4).
-- Décisions Phase 0 : retour 30 j par défaut (d3), fuseau figé à l'ingestion (e), frais par
-- passerelle « à confirmer » tant que non validés (16), historique 24 mois (d6).
CREATE TABLE IF NOT EXISTS public.shop_settings (
  shop_domain                 TEXT        PRIMARY KEY,
  shop_timezone               TEXT,                          -- IANA, mémorisé : day_local est figé avec ce fuseau
  shop_currency               TEXT,                          -- devise boutique (shopMoney), jamais la devise de présentation
  locale_override             TEXT,                          -- langue forcée par le marchand (sinon locale de l'admin)
  vat_regime                  TEXT        NOT NULL DEFAULT 'assujetti',
  shipping_model              TEXT        NOT NULL DEFAULT 'dropshipping',
  default_import_country      TEXT        NOT NULL DEFAULT 'Chine',
  shopify_fee_pct             NUMERIC(8,4)  NOT NULL DEFAULT 2.0,   -- repli si aucune règle de passerelle
  processor_fee_pct           NUMERIC(8,4)  NOT NULL DEFAULT 1.5,
  processor_fixed_fee         NUMERIC(14,2) NOT NULL DEFAULT 0.25,
  gateway_fee_rules           JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{gateway, pct, fixed, confirmed}] (décision 16)
  profitability_threshold_pct NUMERIC(8,4)  NOT NULL DEFAULT 0,
  target_margin_after_ads_pct NUMERIC(8,4),                  -- ROAS cible = 1 / (CM2% − cette marge)
  current_cpa                 NUMERIC(14,2),
  current_cpa_updated_at      TIMESTAMPTZ,
  return_window_days          INTEGER     NOT NULL DEFAULT 30,      -- décision 3
  delivery_promise_days       INTEGER,                              -- promesse de livraison saisie (jours ouvrés lun-ven, décision 15)
  b2b_tag                     TEXT,                                 -- étiquette de surcharge B2B (décision 9)
  history_months              INTEGER     NOT NULL DEFAULT 24,      -- décision 6
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.shop_settings;
CREATE POLICY "deny_public_access" ON public.shop_settings
  FOR ALL USING (false) WITH CHECK (false);

-- shop_plans.shipping_model a été créée À LA MAIN en prod (aucune migration ne la porte : la
-- colonne trouvée dans 20260622_variant_costs.sql est celle de variant_costs). Documentée ici
-- de façon idempotente : sans effet en prod, indispensable sur une base rejouée depuis zéro.
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS shipping_model TEXT NOT NULL DEFAULT 'dropshipping';

-- Copie des réglages existants (idempotente : une boutique déjà copiée n'est pas écrasée).
INSERT INTO public.shop_settings (
  shop_domain, vat_regime, shipping_model, default_import_country,
  shopify_fee_pct, processor_fee_pct, processor_fixed_fee,
  profitability_threshold_pct, current_cpa, current_cpa_updated_at, updated_at
)
SELECT
  shop_domain,
  COALESCE(vat_regime, 'assujetti'),
  COALESCE(shipping_model, 'dropshipping'),
  COALESCE(default_import_country, 'Chine'),
  COALESCE(shopify_fee_pct, 2.0),
  COALESCE(processor_fee_pct, 1.5),
  COALESCE(processor_fixed_fee, 0.25),
  COALESCE(profitability_threshold_pct, 0),
  current_cpa,
  current_cpa_updated_at,
  COALESCE(updated_at, NOW())
FROM public.shop_plans
ON CONFLICT (shop_domain) DO NOTHING;
