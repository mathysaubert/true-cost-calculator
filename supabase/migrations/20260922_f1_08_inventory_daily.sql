-- F1-08 — Instantané quotidien du stock par variante (module 10.11 : couverture, point de
-- commande, ruptures). Alimenté par INVENTORY_LEVELS_UPDATE + un instantané quotidien. Une variante
-- non suivie (tracked=false, dropshipping) est exclue du module ; l'écran est masqué si aucun stock
-- n'est suivi.
CREATE TABLE IF NOT EXISTS public.inventory_daily (
  shop_domain     TEXT        NOT NULL,
  day_local       DATE        NOT NULL,
  variant_id      TEXT        NOT NULL,
  product_id      TEXT,
  available       INTEGER,
  tracked         BOOLEAN     NOT NULL DEFAULT true,
  cost_per_unit   NUMERIC(14,2),                              -- valorisation des totaux (coût)
  in_stock        BOOLEAN,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, day_local, variant_id)
);

ALTER TABLE public.inventory_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.inventory_daily;
CREATE POLICY "deny_public_access" ON public.inventory_daily
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_inventory_daily_shop_product ON public.inventory_daily(shop_domain, product_id, day_local);
