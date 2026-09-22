-- F1-04 — Remboursements réels (webhook REFUNDS_CREATE + bulk/réconciliation). Déduits de CM2
-- (brief §7) à la LECTURE : une commande passée garde sa marge figée, l'agrégat la corrige.
-- settled = au moins une transaction kind=REFUND status=SUCCESS (règle D4 existante,
-- effectiveRefundedQty) ; un restock sans remboursement n'est pas un remboursement.
CREATE TABLE IF NOT EXISTS public.refunds (
  shop_domain        TEXT        NOT NULL,
  refund_id          TEXT        NOT NULL,                     -- gid://shopify/Refund/…
  order_id           TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  day_local          DATE        NOT NULL,
  total_refunded     NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_refunded  NUMERIC(14,2) NOT NULL DEFAULT 0,        -- suit la règle du port client (décision 1)
  line_items         JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{line_item_id, quantity, subtotal}]
  transactions       JSONB       NOT NULL DEFAULT '[]'::jsonb, -- [{kind, status, amount}]
  settled            BOOLEAN     NOT NULL DEFAULT false,
  ingested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, refund_id)
);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.refunds;
CREATE POLICY "deny_public_access" ON public.refunds
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_refunds_shop_order ON public.refunds(shop_domain, order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_shop_day   ON public.refunds(shop_domain, day_local);
