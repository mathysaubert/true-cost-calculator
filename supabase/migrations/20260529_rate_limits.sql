-- Rate limiting table for AI recommendations and Catalog Audits.
-- Counts calls per shop per action per day (UTC).
-- Run this migration in Supabase SQL Editor before deploying.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  shop_domain TEXT NOT NULL,
  action      TEXT NOT NULL,
  day         TEXT NOT NULL, -- YYYY-MM-DD UTC
  count       INTEGER NOT NULL DEFAULT 1,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (shop_domain, action, day)
);

-- Only the service role key should write to this table.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- No public policies — access via service key only (server-side).
