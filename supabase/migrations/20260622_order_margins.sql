-- Brique B — Monitor commandes : historique de marge réelle par ligne de commande.
-- AUCUNE marge calculée en SQL : unit_net_margin/line_net_margin sont TOUJOURS des
-- sorties de computeMargin (engine.js). Supabase ne stocke que faits + snapshot +
-- agrégats (×, sommes, prorata). Snapshot figé → l'historique ne bouge jamais.

CREATE TABLE IF NOT EXISTS public.order_margins (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain        TEXT        NOT NULL,
  order_id           TEXT        NOT NULL,
  line_item_id       TEXT        NOT NULL,
  variant_id         TEXT,                       -- null = variante supprimée / introuvable
  product_id         TEXT,
  order_created_at   TIMESTAMPTZ,                -- = now passé au moteur (douane historique D5)
  quantity           INTEGER     NOT NULL,
  refunded_qty       INTEGER     NOT NULL DEFAULT 0,
  effective_qty      INTEGER     NOT NULL DEFAULT 0,
  net_unit_revenue   NUMERIC,                    -- TTC net (D1), null si coûts manquants
  unit_net_margin    NUMERIC,                    -- computeMargin().margeNette (par unité)
  line_net_margin    NUMERIC,                    -- unit × effective_qty − fixe prorata (D3)
  line_net_revenue   NUMERIC,                    -- net_unit_revenue × effective_qty
  allocated_fixed_fee NUMERIC,                   -- prorata du fixe processeur (D3)
  cost_source        TEXT        NOT NULL DEFAULT 'missing', -- estimated|confirmed|imported|missing
  cost_snapshot_json JSONB,                      -- coûts variant_costs figés à l'ingestion
  currency_code      TEXT,
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, order_id, line_item_id)
);

ALTER TABLE public.order_margins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.order_margins;
CREATE POLICY "deny_public_access" ON public.order_margins
  FOR ALL USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS idx_order_margins_shop      ON public.order_margins(shop_domain);
CREATE INDEX IF NOT EXISTS idx_order_margins_shop_date ON public.order_margins(shop_domain, order_created_at);

-- Bookkeeping du backfill (1 ligne par boutique).
CREATE TABLE IF NOT EXISTS public.order_sync_state (
  shop_domain        TEXT        PRIMARY KEY,
  window_start       TIMESTAMPTZ,
  last_backfill_at   TIMESTAMPTZ,
  bulk_operation_id  TEXT,
  status             TEXT        NOT NULL DEFAULT 'idle' -- idle|running|completed|failed
);

ALTER TABLE public.order_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.order_sync_state;
CREATE POLICY "deny_public_access" ON public.order_sync_state
  FOR ALL USING (false) WITH CHECK (false);

-- D2 : fees % au niveau boutique (défauts INDICATIFS, éditables dès la v1).
-- Shopify 2.0 %, Stripe EU 1.5 %, fixe 0.25 € — varient selon plan/pays de la carte.
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS shopify_fee_pct     NUMERIC NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS processor_fee_pct   NUMERIC NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS processor_fixed_fee NUMERIC NOT NULL DEFAULT 0.25;
