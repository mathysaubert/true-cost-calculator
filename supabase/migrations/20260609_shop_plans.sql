-- Persist active plan per shop — synced from Shopify API on every loader run.
-- Values: 'free' | 'pro' | 'expert'
CREATE TABLE IF NOT EXISTS shop_plans (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT        NOT NULL UNIQUE,
  plan        TEXT        NOT NULL DEFAULT 'free',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_plans ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shop_plans_shop ON shop_plans(shop_domain);
