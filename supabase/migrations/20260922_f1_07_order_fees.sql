-- F1-07 — Frais de paiement PAR COMMANDE. source='shopify_payments' : frais réels lus dans
-- ShopifyPaymentsBalanceTransaction (fee/net, associatedOrder) — scope read_shopify_payments_payouts.
-- source='manual_rule' : taux par passerelle réglé par le marchand (shop_settings.gateway_fee_rules),
-- confirmed=false tant qu'il ne l'a pas validé → affiché « à confirmer » (décision 16).
-- Fait externe figé : jamais recalculé pour une commande passée.
CREATE TABLE IF NOT EXISTS public.order_fees (
  shop_domain           TEXT        NOT NULL,
  order_id              TEXT        NOT NULL,
  order_transaction_id  TEXT        NOT NULL,                 -- gid de l'OrderTransaction (ou 'rule:<gateway>' pour une règle)
  gateway               TEXT        NOT NULL,
  gross_amount          NUMERIC(14,2),
  fee_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(14,2),
  currency_code         TEXT,
  transaction_date      TIMESTAMPTZ,
  source                TEXT        NOT NULL CHECK (source IN ('shopify_payments', 'manual_rule')),
  confirmed             BOOLEAN     NOT NULL DEFAULT false,
  ingested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, order_id, order_transaction_id)
);

ALTER TABLE public.order_fees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.order_fees;
CREATE POLICY "deny_public_access" ON public.order_fees
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_order_fees_shop_order ON public.order_fees(shop_domain, order_id);
