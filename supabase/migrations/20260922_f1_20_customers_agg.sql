-- F1-20 — Agrégats par client (cohortes, rachat, LTV en CM2 — module 10.8). customer_id = gid brut
-- (décision b), niveau 1 : AUCUN champ nominatif. Dérivée d'orders, reconstructible ; supprimée par
-- redact_customer (customers/redact) et par purge_shop. Les achats invités (customer_id NULL sur la
-- commande) n'ont pas de ligne ici : ils sont comptés « sans client identifié » à l'écran.
CREATE TABLE IF NOT EXISTS public.customers_agg (
  shop_domain        TEXT        NOT NULL,
  customer_id        TEXT        NOT NULL,
  first_order_at     TIMESTAMPTZ,
  first_order_day    DATE,
  cohort_month       TEXT,                                     -- YYYY-MM de la première commande
  first_channel      TEXT,                                     -- source_name / visit_source de la première commande
  first_utm_source   TEXT,
  orders_count       INTEGER     NOT NULL DEFAULT 0,
  units              INTEGER     NOT NULL DEFAULT 0,
  ca_ht_total        NUMERIC(14,2) NOT NULL DEFAULT 0,
  cm2_total          NUMERIC(14,2),                            -- NULL si une commande a un coût manquant
  last_order_at      TIMESTAMPTZ,
  second_order_at    TIMESTAMPTZ,                              -- délai avant le deuxième achat
  refreshed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, customer_id)
);

ALTER TABLE public.customers_agg ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.customers_agg;
CREATE POLICY "deny_public_access" ON public.customers_agg
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_customers_agg_shop_cohort ON public.customers_agg(shop_domain, cohort_month);
