-- Alerting produit-à-perte (Brique 1) — état de rentabilité PAR PRODUIT, 1 ligne par
-- (shop, produit). Sert au cron quotidien pour détecter les BASCULEMENTS rentable↔perte
-- d'un run à l'autre. AUCUNE marge calculée ici : last_margin est une copie de
-- Σ line_net_margin déjà produit par aggregateOrderMargins (orderHistory.js, pur).
--
-- last_state : 'profitable' | 'loss' (perte STRICTE = Σ line_net_margin < 0).
-- Absence de ligne pour un (shop, produit) = état inconnu :
--   • shop sans AUCUNE ligne  → premier passage → seed silencieux (pas de mail).
--   • produit nouveau sur shop connu → seed individuel (pas de mail).
-- Les produits multi-devises (currency 'MIXED') ne sont JAMAIS suivis ici
-- (somme cross-devise interdite) — l'alerting les exclut en amont.
CREATE TABLE IF NOT EXISTS public.product_profitability_state (
  shop_domain     TEXT        NOT NULL,
  product_id      TEXT        NOT NULL,
  last_state      TEXT        NOT NULL,            -- 'profitable' | 'loss'
  last_margin     NUMERIC,                          -- Σ line_net_margin au dernier run (mail/debug)
  currency_code   TEXT,                             -- devise du produit (mono-devise uniquement)
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, product_id)
);

ALTER TABLE public.product_profitability_state ENABLE ROW LEVEL SECURITY;

-- Deny-all : accès serveur uniquement via service role (bypass RLS), comme order_margins.
-- DROP IF EXISTS d'abord : CREATE POLICY n'est pas idempotent → fichier ré-exécutable.
DROP POLICY IF EXISTS "deny_public_access" ON public.product_profitability_state;
CREATE POLICY "deny_public_access" ON public.product_profitability_state
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_pps_shop ON public.product_profitability_state(shop_domain);
