-- F1-21 — Alertes : règles (une ligne par type, décision d) + état (généralise
-- product_profitability_state : transitions seulement, seeds silencieux, avancement SSI envoi réussi).
-- product_profitability_state est CONSERVÉE (le cron en production la lit) ; ses lignes sont copiées
-- ici une fois (idempotent). Elle sera supprimée avec le cron qui bascule (I1).
CREATE TABLE IF NOT EXISTS public.alert_rules (
  shop_domain   TEXT        NOT NULL,
  alert_type    TEXT        NOT NULL,                          -- product_loss | cm2_below_target | stock_reorder | cac_above_be | return_reason | otd | ad_connection …
  enabled       BOOLEAN     NOT NULL DEFAULT true,
  threshold     NUMERIC(14,4),
  config        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  channels      TEXT[]      NOT NULL DEFAULT '{app,email}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, alert_type)
);

ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.alert_rules;
CREATE POLICY "deny_public_access" ON public.alert_rules
  FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.alert_state (
  shop_domain        TEXT        NOT NULL,
  alert_type         TEXT        NOT NULL,
  subject_key        TEXT        NOT NULL,                     -- product_id, campaign_id, 'shop', …
  last_state         TEXT        NOT NULL,
  last_value         NUMERIC(14,4),
  currency_code      TEXT,
  last_checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_notified_at   TIMESTAMPTZ,
  payload            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (shop_domain, alert_type, subject_key)
);

ALTER TABLE public.alert_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.alert_state;
CREATE POLICY "deny_public_access" ON public.alert_state
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_alert_state_shop_type ON public.alert_state(shop_domain, alert_type);

-- Copie unique de l'état d'alerting produit existant.
INSERT INTO public.alert_state (shop_domain, alert_type, subject_key, last_state, last_value, currency_code, last_checked_at)
SELECT shop_domain, 'product_loss', product_id, last_state, last_margin, currency_code, last_checked_at
FROM public.product_profitability_state
ON CONFLICT (shop_domain, alert_type, subject_key) DO NOTHING;
