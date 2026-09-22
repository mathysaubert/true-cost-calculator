-- F1-05 — Retours Shopify avec motifs (scope read_returns, webhooks RETURNS_*). Motif = enum
-- Shopify ReturnReason (10 valeurs) porté par chaque ligne ; absent si le marchand utilise une
-- app tierce qui n'écrit pas dans Shopify (trou visible, jamais un zéro).
CREATE TABLE IF NOT EXISTS public.returns (
  shop_domain    TEXT        NOT NULL,
  return_id      TEXT        NOT NULL,                       -- gid://shopify/Return/…
  order_id       TEXT        NOT NULL,
  status         TEXT,                                       -- REQUESTED | OPEN | CLOSED | DECLINED | CANCELED
  requested_at   TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ,
  day_local      DATE        NOT NULL,
  line_items     JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{line_item_id, quantity, return_reason, note}]
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, return_id)
);

ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.returns;
CREATE POLICY "deny_public_access" ON public.returns
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_returns_shop_order ON public.returns(shop_domain, order_id);
CREATE INDEX IF NOT EXISTS idx_returns_shop_day   ON public.returns(shop_domain, day_local);
