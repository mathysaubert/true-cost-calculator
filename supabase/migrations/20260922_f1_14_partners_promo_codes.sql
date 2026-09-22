-- F1-14 — Partenaires, codes promo et commissions (module 10.6, brief §7).
-- Un partenaire est en mode 'codes' (commission déduite des commandes portant ses codes) OU 'manual'
-- (commissions saisies par période, pour les partenaires sans code) — jamais les deux, pour éviter
-- les doublons ; la règle est portée par partners.mode et appliquée côté application (un CHECK
-- inter-tables n'existe pas en SQL).
CREATE TABLE IF NOT EXISTS public.partners (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain   TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  mode          TEXT        NOT NULL DEFAULT 'codes' CHECK (mode IN ('codes', 'manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, name)
);

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.partners;
CREATE POLICY "deny_public_access" ON public.partners
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_partners_shop ON public.partners(shop_domain);

-- commission_base réglable par code, défaut CA HT après remise (décision 2).
CREATE TABLE IF NOT EXISTS public.promo_code_rules (
  shop_domain      TEXT        NOT NULL,
  code             TEXT        NOT NULL,                       -- code tel qu'il apparaît sur la commande (casse normalisée à l'ingestion)
  partner_id       UUID        REFERENCES public.partners(id) ON DELETE SET NULL,
  commission_pct   NUMERIC(8,4) NOT NULL DEFAULT 0,
  commission_base  TEXT        NOT NULL DEFAULT 'ht_after_discount'
                               CHECK (commission_base IN ('ht_after_discount', 'ht_before_discount')),
  active_from      DATE,
  active_to        DATE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, code)
);

ALTER TABLE public.promo_code_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.promo_code_rules;
CREATE POLICY "deny_public_access" ON public.promo_code_rules
  FOR ALL USING (false) WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.manual_commissions (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain    TEXT        NOT NULL,
  partner_id     UUID        NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  period_month   TEXT        NOT NULL,                         -- YYYY-MM
  amount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency_code  TEXT,
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, partner_id, period_month)
);

ALTER TABLE public.manual_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.manual_commissions;
CREATE POLICY "deny_public_access" ON public.manual_commissions
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_manual_commissions_shop_period ON public.manual_commissions(shop_domain, period_month);
