-- F1-19 — Rollups quotidiens : CACHE reconstructible des nœuds du graphe économique (jamais une
-- source de vérité : tout se recalcule depuis les faits). daily_rollups (boutique) et
-- product_daily_rollups (produit) portent EXACTEMENT le même jeu de colonnes de métriques, dans le
-- même ordre : une future variant_daily_rollups = ce jeu + variant_id, sans toucher au reste
-- (décision f). Les sessions n'existent qu'au niveau boutique (NULL au niveau produit).
-- provisional_* = ventes encore dans le délai de retour (comptées sans retour, affichées provisoires).
CREATE TABLE IF NOT EXISTS public.daily_rollups (
  shop_domain          TEXT        NOT NULL,
  day_local            DATE        NOT NULL,
  orders_count         INTEGER     NOT NULL DEFAULT 0,
  units                INTEGER     NOT NULL DEFAULT 0,
  new_customers        INTEGER     NOT NULL DEFAULT 0,
  ca_brut              NUMERIC(14,2) NOT NULL DEFAULT 0,
  remises              NUMERIC(14,2) NOT NULL DEFAULT 0,
  rembours             NUMERIC(14,2) NOT NULL DEFAULT 0,
  ca_net               NUMERIC(14,2) NOT NULL DEFAULT 0,
  ca_ht                NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs                 NUMERIC(14,2),                          -- coût produit rendu ; NULL si un coût manque (jamais 0)
  cm1                  NUMERIC(14,2),
  shipping_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,
  packaging_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_fees         NUMERIC(14,2) NOT NULL DEFAULT 0,
  returns_cost         NUMERIC(14,2) NOT NULL DEFAULT 0,
  cm2                  NUMERIC(14,2),
  ad_spend             NUMERIC(14,2) NOT NULL DEFAULT 0,
  commissions          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cm3                  NUMERIC(14,2),
  fixed_costs_alloc    NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_result           NUMERIC(14,2),
  unknown_cost_lines   INTEGER     NOT NULL DEFAULT 0,        -- lignes à marge inconnue (compteur visible)
  provisional_orders   INTEGER     NOT NULL DEFAULT 0,
  provisional_ca_ht    NUMERIC(14,2) NOT NULL DEFAULT 0,
  sessions             INTEGER,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (shop_domain, day_local)
);

ALTER TABLE public.daily_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.daily_rollups;
CREATE POLICY "deny_public_access" ON public.daily_rollups
  FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.product_daily_rollups (
  shop_domain          TEXT        NOT NULL,
  day_local            DATE        NOT NULL,
  product_id           TEXT        NOT NULL,
  orders_count         INTEGER     NOT NULL DEFAULT 0,
  units                INTEGER     NOT NULL DEFAULT 0,
  new_customers        INTEGER     NOT NULL DEFAULT 0,
  ca_brut              NUMERIC(14,2) NOT NULL DEFAULT 0,
  remises              NUMERIC(14,2) NOT NULL DEFAULT 0,
  rembours             NUMERIC(14,2) NOT NULL DEFAULT 0,
  ca_net               NUMERIC(14,2) NOT NULL DEFAULT 0,
  ca_ht                NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs                 NUMERIC(14,2),
  cm1                  NUMERIC(14,2),
  shipping_cost        NUMERIC(14,2) NOT NULL DEFAULT 0,
  packaging_cost       NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_fees         NUMERIC(14,2) NOT NULL DEFAULT 0,
  returns_cost         NUMERIC(14,2) NOT NULL DEFAULT 0,
  cm2                  NUMERIC(14,2),
  ad_spend             NUMERIC(14,2) NOT NULL DEFAULT 0,
  commissions          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cm3                  NUMERIC(14,2),
  fixed_costs_alloc    NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_result           NUMERIC(14,2),
  unknown_cost_lines   INTEGER     NOT NULL DEFAULT 0,
  provisional_orders   INTEGER     NOT NULL DEFAULT 0,
  provisional_ca_ht    NUMERIC(14,2) NOT NULL DEFAULT 0,
  sessions             INTEGER,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version              INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (shop_domain, day_local, product_id)
);

ALTER TABLE public.product_daily_rollups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.product_daily_rollups;
CREATE POLICY "deny_public_access" ON public.product_daily_rollups
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_product_daily_rollups_shop_product ON public.product_daily_rollups(shop_domain, product_id, day_local);
