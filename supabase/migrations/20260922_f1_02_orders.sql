-- F1-02 — Commandes : une ligne par commande Shopify (faits + attribution), base de tous les KPI.
-- Montants en devise BOUTIQUE (shopMoney). CA HT calculé à l'ingestion depuis taxLines/taxesIncluded
-- (jamais par hypothèse de taux). day_local = jour dans le fuseau boutique, FIGÉ à l'ingestion (e).
-- Données clients protégées niveau 1 : customer_id (gid brut, décision b), country_code seul,
-- AUCUN nom, e-mail, téléphone ni adresse (décision c).
-- excluded_reason non nul = commande hors de tous les KPI (brief §9) ; la ligne est conservée pour
-- l'audit et le compteur « trous visibles ».
CREATE TABLE IF NOT EXISTS public.orders (
  shop_domain            TEXT        NOT NULL,
  order_id               TEXT        NOT NULL,                 -- gid://shopify/Order/…
  order_name             TEXT,                                 -- #1001
  created_at             TIMESTAMPTZ NOT NULL,
  processed_at           TIMESTAMPTZ,
  cancelled_at           TIMESTAMPTZ,
  day_local              DATE        NOT NULL,
  is_test                BOOLEAN     NOT NULL DEFAULT false,
  source_name            TEXT,                                 -- web | pos | shopify_draft_order | …
  gateway_names          TEXT[]      NOT NULL DEFAULT '{}',    -- paymentGatewayNames (frais réels ou règle manuelle)
  purchasing_company_id  TEXT,                                 -- purchasingEntity Company → B2B (décision 9)
  customer_id            TEXT,                                 -- gid brut, NULL = achat invité
  customer_order_index   INTEGER,                              -- 1 = première commande du client (BE-CAC)
  currency_code          TEXT        NOT NULL,
  taxes_included         BOOLEAN,
  subtotal_ttc           NUMERIC(14,2),
  discounts_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_codes         TEXT[]      NOT NULL DEFAULT '{}',    -- codes promo → commissions (10.6)
  shipping_charged       NUMERIC(14,2) NOT NULL DEFAULT 0,    -- port payé par le client : dans le CA brut (décision 1)
  tax_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ttc              NUMERIC(14,2),
  ca_ht                  NUMERIC(14,2),
  utm_source             TEXT,
  utm_medium             TEXT,
  utm_campaign           TEXT,
  utm_content            TEXT,
  utm_term               TEXT,
  visit_source           TEXT,                                 -- CustomerVisit.source
  visit_source_type      TEXT,                                 -- CustomerVisit.sourceType (MarketingTactic)
  landing_page           TEXT,
  attribution_ready      BOOLEAN     NOT NULL DEFAULT false,   -- customerJourneySummary.ready (re-tirage différé)
  country_code           CHAR(2),                              -- pays de livraison, code seul
  excluded_reason        TEXT        CHECK (excluded_reason IN ('test', 'cancelled', 'gift_card_only', 'draft', 'b2b')),
  ingested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, order_id)
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.orders;
CREATE POLICY "deny_public_access" ON public.orders
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_orders_shop_day       ON public.orders(shop_domain, day_local);
CREATE INDEX IF NOT EXISTS idx_orders_shop_created   ON public.orders(shop_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_shop_customer  ON public.orders(shop_domain, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shop_included  ON public.orders(shop_domain, day_local) WHERE excluded_reason IS NULL;
