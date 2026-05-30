-- Initial schema for true-cost-calculator
-- These tables were created ad-hoc; this migration documents and recreates them.

-- ── calculations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calculations (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain         TEXT        NOT NULL,
  product_id          TEXT,
  product_title       TEXT,
  category            TEXT,
  country             TEXT,
  purchase_price      NUMERIC(10, 2),
  selling_price       NUMERIC(10, 2),
  net_margin_percent  NUMERIC(10, 4),
  net_margin_euros    NUMERIC(10, 2),
  shopify_fee         NUMERIC(10, 4),
  stripe_fee          NUMERIC(10, 4),
  returns_rate        NUMERIC(10, 4),
  ads_rate            NUMERIC(10, 4),
  shipping_cost       NUMERIC(10, 2),
  customs_rate        NUMERIC(10, 4),
  cout_rendu          NUMERIC(10, 2),
  marge_brute_percent NUMERIC(10, 4),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calculations_shop_created
  ON public.calculations (shop_domain, created_at DESC);

ALTER TABLE public.calculations ENABLE ROW LEVEL SECURITY;

-- ── usage ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.usage (
  shop_domain         TEXT        NOT NULL,
  month               TEXT        NOT NULL,  -- format YYYY-MM
  calculation_count   INTEGER     NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (shop_domain, month)
);

ALTER TABLE public.usage ENABLE ROW LEVEL SECURITY;

-- ── margin_alerts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.margin_alerts (
  shop_domain TEXT        PRIMARY KEY,
  threshold   NUMERIC(6, 2) NOT NULL DEFAULT 25,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.margin_alerts ENABLE ROW LEVEL SECURITY;

-- ── calculation_annotations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calculation_annotations (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain     TEXT        NOT NULL,
  calculation_id  UUID        NOT NULL REFERENCES public.calculations (id) ON DELETE CASCADE,
  note            TEXT        NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_domain, calculation_id)
);

CREATE INDEX IF NOT EXISTS annotations_shop
  ON public.calculation_annotations (shop_domain);

ALTER TABLE public.calculation_annotations ENABLE ROW LEVEL SECURITY;
