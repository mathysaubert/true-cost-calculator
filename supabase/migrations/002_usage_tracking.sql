-- True Cost Calculator — suivi des calculs gratuits
-- À exécuter dans : Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS usage (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain        TEXT        NOT NULL,
  month              TEXT        NOT NULL, -- format YYYY-MM
  calculation_count  INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT usage_shop_month_unique UNIQUE (shop_domain, month)
);

ALTER TABLE usage ENABLE ROW LEVEL SECURITY;

-- Index composite pour les lookups fréquents
CREATE INDEX IF NOT EXISTS usage_shop_month_idx
  ON usage (shop_domain, month);
