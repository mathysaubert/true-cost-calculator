-- F1-15 — Coûts fixes saisis par le marchand (résultat net = CM3 − coûts fixes). Montant mensuel
-- dans la devise boutique ; période d'activité pour l'historique. Aucune saisie = résultat net
-- affiché comme CM3 avec le trou « coûts fixes non renseignés » (principe 5).
CREATE TABLE IF NOT EXISTS public.fixed_costs (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain     TEXT        NOT NULL,
  label           TEXT        NOT NULL,
  amount_monthly  NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency_code   TEXT,
  active_from     DATE,
  active_to       DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fixed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.fixed_costs;
CREATE POLICY "deny_public_access" ON public.fixed_costs
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_fixed_costs_shop ON public.fixed_costs(shop_domain);
