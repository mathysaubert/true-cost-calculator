-- F1-06 — Expéditions (module 10.10). created_at = date d'expédition ; delivered_at vient de
-- l'événement DELIVERED (FulfillmentEvent.happenedAt) quand le transporteur remonte dans Shopify —
-- sinon NULL et l'OTD est « indisponible », jamais zéro. promised_at = commande + promesse saisie,
-- en jours ouvrés lundi-vendredi dans le fuseau boutique (décision 15), calculé à l'ingestion.
CREATE TABLE IF NOT EXISTS public.fulfillments (
  shop_domain            TEXT        NOT NULL,
  fulfillment_id         TEXT        NOT NULL,                 -- gid://shopify/Fulfillment/…
  order_id               TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL,                 -- expédition
  status                 TEXT,
  tracking_company       TEXT,
  tracking_numbers       TEXT[]      NOT NULL DEFAULT '{}',
  delivered_at           TIMESTAMPTZ,
  last_event_status      TEXT,
  last_event_at          TIMESTAMPTZ,
  estimated_delivery_at  TIMESTAMPTZ,
  promised_at            TIMESTAMPTZ,
  country_code           CHAR(2),
  day_local              DATE        NOT NULL,
  ingested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, fulfillment_id)
);

ALTER TABLE public.fulfillments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.fulfillments;
CREATE POLICY "deny_public_access" ON public.fulfillments
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_fulfillments_shop_order ON public.fulfillments(shop_domain, order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillments_shop_day   ON public.fulfillments(shop_domain, day_local);
