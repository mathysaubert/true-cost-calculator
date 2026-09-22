-- F1-11 — Search Console (module 10.12) : performance par jour et dimension (requête, page, pays,
-- appareil) + statut d'indexation par page. pulled_at = fraîcheur affichée (GSC est en différé).
CREATE TABLE IF NOT EXISTS public.seo_daily (
  shop_domain   TEXT        NOT NULL,
  day_local     DATE        NOT NULL,
  dim_type      TEXT        NOT NULL CHECK (dim_type IN ('query', 'page', 'country', 'device')),
  dim_value     TEXT        NOT NULL,
  clicks        INTEGER     NOT NULL DEFAULT 0,
  impressions   INTEGER     NOT NULL DEFAULT 0,
  ctr           NUMERIC(8,4),
  position      NUMERIC(8,2),
  pulled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, day_local, dim_type, dim_value)
);

ALTER TABLE public.seo_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.seo_daily;
CREATE POLICY "deny_public_access" ON public.seo_daily
  FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.seo_index_status (
  shop_domain   TEXT        NOT NULL,
  page_url      TEXT        NOT NULL,
  indexed       BOOLEAN,
  verdict       TEXT,                                          -- verdict brut de l'inspection d'URL
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, page_url)
);

ALTER TABLE public.seo_index_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.seo_index_status;
CREATE POLICY "deny_public_access" ON public.seo_index_status
  FOR ALL USING (false) WITH CHECK (false);
