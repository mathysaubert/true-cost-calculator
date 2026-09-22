-- F1-09 — Sessions agrégées par jour, source et appareil (module 10.7), depuis ShopifyQL
-- (dataset sessions, filtre human_or_bot_session = 'human'). AGRÉGATS UNIQUEMENT : aucune session
-- individuelle, aucune donnée nominative (le niveau 2 exigé par Shopify pour shopifyqlQuery ne
-- change rien à ce qui est stocké). pulled_at = fraîcheur affichée à l'écran (source « not real time »).
CREATE TABLE IF NOT EXISTS public.sessions_daily (
  shop_domain         TEXT        NOT NULL,
  day_local           DATE        NOT NULL,
  source              TEXT        NOT NULL DEFAULT '',          -- source de trafic (dimension ShopifyQL)
  device              TEXT        NOT NULL DEFAULT '',          -- appareil
  sessions            INTEGER     NOT NULL DEFAULT 0,
  visitors            INTEGER     NOT NULL DEFAULT 0,
  pageviews           INTEGER     NOT NULL DEFAULT 0,
  atc_sessions        INTEGER     NOT NULL DEFAULT 0,          -- sessions_with_cart_additions
  checkout_sessions   INTEGER     NOT NULL DEFAULT 0,          -- sessions_that_reached_checkout
  purchase_sessions   INTEGER     NOT NULL DEFAULT 0,          -- sessions_that_completed_checkout
  pulled_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, day_local, source, device)
);

ALTER TABLE public.sessions_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.sessions_daily;
CREATE POLICY "deny_public_access" ON public.sessions_daily
  FOR ALL USING (false) WITH CHECK (false);
