-- F1-18 — Idempotence des webhooks : Shopify peut livrer un même événement plusieurs fois et ne
-- garantit pas la livraison (d'où la réconciliation quotidienne). webhook_id = en-tête
-- X-Shopify-Webhook-Id. Un id déjà présent = événement ignoré. Purgé à la désinstallation.
CREATE TABLE IF NOT EXISTS public.webhook_events (
  webhook_id     TEXT        PRIMARY KEY,
  shop_domain    TEXT        NOT NULL,
  topic          TEXT        NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at   TIMESTAMPTZ,
  status         TEXT        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed')),
  error          TEXT
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.webhook_events;
CREATE POLICY "deny_public_access" ON public.webhook_events
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_webhook_events_shop_received ON public.webhook_events(shop_domain, received_at DESC);
