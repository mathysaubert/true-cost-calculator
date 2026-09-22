-- F1-12 — Taux de change quotidiens (référentiel PARTAGÉ, sans shop_domain : seule table hors purge
-- boutique). Source BCE d'abord, fournisseur commercial uniquement si une devise manque (décision 10)
-- — prévu dans le schéma, non branché en V1. Sert à convertir les dépenses pub dans la devise boutique.
CREATE TABLE IF NOT EXISTS public.fx_rates (
  base_currency   TEXT        NOT NULL,
  quote_currency  TEXT        NOT NULL,
  day             DATE        NOT NULL,
  rate            NUMERIC(18,8) NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('ecb', 'provider')),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_currency, quote_currency, day)
);

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.fx_rates;
CREATE POLICY "deny_public_access" ON public.fx_rates
  FOR ALL USING (false) WITH CHECK (false);
