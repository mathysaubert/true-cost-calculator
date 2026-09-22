-- F1-10 — Dépenses et performance publicitaires (Meta, Google Ads, TikTok — module 10.5).
-- Une ligne par jour × plateforme × niveau (compte/campagne/ensemble/pub) × pays ; les niveaux non
-- renseignés valent '' (jamais NULL : ils font partie de la clé). spend_shop_currency = converti
-- via fx_rates (BCE d'abord, décision 10). platform_* = attribution DE LA PLATEFORME, affichée à
-- côté de l'attribution UTM Shopify ; les leviers prennent la plus prudente des deux (brief §7).
CREATE TABLE IF NOT EXISTS public.ad_spend (
  shop_domain          TEXT        NOT NULL,
  day_local            DATE        NOT NULL,
  platform             TEXT        NOT NULL CHECK (platform IN ('meta', 'google_ads', 'tiktok')),
  ad_account_id        TEXT        NOT NULL,
  campaign_id          TEXT        NOT NULL DEFAULT '',
  adset_id             TEXT        NOT NULL DEFAULT '',
  ad_id                TEXT        NOT NULL DEFAULT '',
  country_code         TEXT        NOT NULL DEFAULT '',
  spend                NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency_code        TEXT        NOT NULL,
  spend_shop_currency  NUMERIC(14,2),
  fx_rate              NUMERIC(18,8),
  impressions          BIGINT      NOT NULL DEFAULT 0,
  clicks               BIGINT      NOT NULL DEFAULT 0,
  platform_orders      INTEGER     NOT NULL DEFAULT 0,
  platform_revenue     NUMERIC(14,2) NOT NULL DEFAULT 0,
  attribution_window   TEXT,                                     -- ex. '7d_click_1d_view'
  pulled_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, day_local, platform, ad_account_id, campaign_id, adset_id, ad_id, country_code)
);

ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.ad_spend;
CREATE POLICY "deny_public_access" ON public.ad_spend
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_ad_spend_shop_platform_day ON public.ad_spend(shop_domain, platform, day_local);

-- Dimension des entités publicitaires (noms, statut, hiérarchie, mapping produit).
CREATE TABLE IF NOT EXISTS public.ad_entities (
  shop_domain   TEXT        NOT NULL,
  platform      TEXT        NOT NULL CHECK (platform IN ('meta', 'google_ads', 'tiktok')),
  entity_id     TEXT        NOT NULL,
  level         TEXT        NOT NULL CHECK (level IN ('account', 'campaign', 'adset', 'ad')),
  name          TEXT,
  status        TEXT,
  parent_id     TEXT,
  product_ids   TEXT[]      NOT NULL DEFAULT '{}',              -- mapping pub → produit(s) pour le CM3 par produit
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, platform, entity_id)
);

ALTER TABLE public.ad_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.ad_entities;
CREATE POLICY "deny_public_access" ON public.ad_entities
  FOR ALL USING (false) WITH CHECK (false);
