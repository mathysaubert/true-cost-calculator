-- I0-01 — Mémoire des décisions (Phase 0 I0 §3.7, arbitrage D7a du 2026-09-23).
-- Deux tables NON nominatives (agrégats, identifiants de règles, empreintes) + une fonction
-- d'enregistrement silencieux. Idempotent : IF NOT EXISTS / OR REPLACE partout. Aucune donnée
-- existante touchée. Rollback dédié : supabase/rollback/20260924_i0_rollback.sql.
--
-- insight_log  : ce que le copilote a MONTRÉ (priorités 1-3, opportunité rang 0), une ligne par
--                empreinte (règle + sujet + fenêtre + impact arrondi) ; shown_count s'incrémente à
--                chaque nouvel affichage ; resolved_at se pose quand une règle de données cesse
--                d'être détectée (la donnée a été corrigée → decision_log kind 'data_fixed').
-- decision_log : ce que le marchand a FAIT : simulation retenue, acceptation, rejet, correction
--                de donnée, action lancée / terminée, avec l'impact attendu et, plus tard, observé.
-- Rétention : durée de vie de l'installation (purge_shop, décision g).

CREATE TABLE IF NOT EXISTS public.insight_log (
  shop_domain     TEXT        NOT NULL,
  fingerprint     TEXT        NOT NULL,
  rule_id         TEXT        NOT NULL,
  subject_kind    TEXT        NOT NULL,
  subject_key     TEXT        NOT NULL,
  status          TEXT        NOT NULL,
  rank            SMALLINT,
  window_start    DATE,
  window_end      DATE,
  impact_low      NUMERIC(14,2),
  impact_high     NUMERIC(14,2),
  currency_code   TEXT,
  payload         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  first_shown_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_shown_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shown_count     INTEGER     NOT NULL DEFAULT 1,
  resolved_at     TIMESTAMPTZ,
  PRIMARY KEY (shop_domain, fingerprint)
);

ALTER TABLE public.insight_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.insight_log;
CREATE POLICY "deny_public_access" ON public.insight_log
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_insight_log_shop_rule_window ON public.insight_log(shop_domain, rule_id, window_end);
CREATE INDEX IF NOT EXISTS idx_insight_log_shop_last_shown ON public.insight_log(shop_domain, last_shown_at DESC);

CREATE TABLE IF NOT EXISTS public.decision_log (
  id                    UUID        NOT NULL DEFAULT gen_random_uuid(),
  shop_domain           TEXT        NOT NULL,
  insight_fingerprint   TEXT,
  kind                  TEXT        NOT NULL CHECK (kind IN ('simulated', 'accepted', 'dismissed', 'data_fixed', 'action_started', 'action_done')),
  scenario              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  expected_impact_low   NUMERIC(14,2),
  expected_impact_high  NUMERIC(14,2),
  expected_node         TEXT,
  horizon_days          INTEGER,
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_at             TIMESTAMPTZ,
  observed_impact       NUMERIC(14,2),
  observed_at           TIMESTAMPTZ,
  note                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);

ALTER TABLE public.decision_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.decision_log;
CREATE POLICY "deny_public_access" ON public.decision_log
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_decision_log_shop_decided ON public.decision_log(shop_domain, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_log_shop_kind ON public.decision_log(shop_domain, kind);

-- Enregistrement silencieux d'un lot d'insights affichés : une ligne par empreinte, création ou
-- réaffichage (shown_count + 1, rang / statut / impact / payload rafraîchis, resolved_at effacé
-- puisque la règle est de nouveau détectée). Un seul aller-retour depuis le loader.
CREATE OR REPLACE FUNCTION public.record_insights(p_shop TEXT, p_rows JSONB)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.insight_log (shop_domain, fingerprint, rule_id, subject_kind, subject_key, status, rank, window_start, window_end, impact_low, impact_high, currency_code, payload, first_shown_at, last_shown_at, shown_count)
  SELECT p_shop, r.fingerprint, r.rule_id, r.subject_kind, r.subject_key, r.status, r.rank, r.window_start, r.window_end, r.impact_low, r.impact_high, r.currency_code, COALESCE(r.payload, '{}'::jsonb), NOW(), NOW(), 1
    FROM jsonb_to_recordset(p_rows) AS r(fingerprint TEXT, rule_id TEXT, subject_kind TEXT, subject_key TEXT, status TEXT, rank SMALLINT, window_start DATE, window_end DATE, impact_low NUMERIC, impact_high NUMERIC, currency_code TEXT, payload JSONB)
  ON CONFLICT (shop_domain, fingerprint) DO UPDATE
    SET status        = EXCLUDED.status,
        rank          = EXCLUDED.rank,
        impact_low    = EXCLUDED.impact_low,
        impact_high   = EXCLUDED.impact_high,
        currency_code = EXCLUDED.currency_code,
        payload       = EXCLUDED.payload,
        last_shown_at = NOW(),
        shown_count   = public.insight_log.shown_count + 1,
        resolved_at   = NULL;
$$;

-- purge_shop : même corps que F1-23 (ordre conservé) + les deux tables de la mémoire des décisions.
-- Le lot 23 vérifie que la DERNIÈRE définition vide exactement PURGE_TABLES et que la liste F1-23
-- en est un préfixe ; le rollback I0 rétablit la définition F1-23.
CREATE OR REPLACE FUNCTION public.purge_shop(p_shop TEXT)
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.manual_commissions        WHERE shop_domain = p_shop;
  DELETE FROM public.promo_code_rules          WHERE shop_domain = p_shop;
  DELETE FROM public.partners                  WHERE shop_domain = p_shop;
  DELETE FROM public.calculation_annotations   WHERE shop_domain = p_shop;
  DELETE FROM public.calculations              WHERE shop_domain = p_shop;
  DELETE FROM public.usage                     WHERE shop_domain = p_shop;
  DELETE FROM public.margin_alerts             WHERE shop_domain = p_shop;
  DELETE FROM public.rate_limits               WHERE shop_domain = p_shop;
  DELETE FROM public.product_profitability_state WHERE shop_domain = p_shop;
  DELETE FROM public.subscription_dunning_state WHERE shop_domain = p_shop;
  DELETE FROM public.session_health            WHERE shop_domain = p_shop;
  DELETE FROM public.variant_costs             WHERE shop_domain = p_shop;
  DELETE FROM public.order_margins             WHERE shop_domain = p_shop;
  DELETE FROM public.order_sync_state          WHERE shop_domain = p_shop;
  DELETE FROM public.shop_plans                WHERE shop_domain = p_shop;
  DELETE FROM public.shop_settings             WHERE shop_domain = p_shop;
  DELETE FROM public.orders                    WHERE shop_domain = p_shop;
  DELETE FROM public.refunds                   WHERE shop_domain = p_shop;
  DELETE FROM public.returns                   WHERE shop_domain = p_shop;
  DELETE FROM public.fulfillments              WHERE shop_domain = p_shop;
  DELETE FROM public.order_fees                WHERE shop_domain = p_shop;
  DELETE FROM public.inventory_daily           WHERE shop_domain = p_shop;
  DELETE FROM public.sessions_daily            WHERE shop_domain = p_shop;
  DELETE FROM public.ad_spend                  WHERE shop_domain = p_shop;
  DELETE FROM public.ad_entities               WHERE shop_domain = p_shop;
  DELETE FROM public.seo_daily                 WHERE shop_domain = p_shop;
  DELETE FROM public.seo_index_status          WHERE shop_domain = p_shop;
  DELETE FROM public.fixed_costs               WHERE shop_domain = p_shop;
  DELETE FROM public.integration_connections   WHERE shop_domain = p_shop;
  DELETE FROM public.sync_jobs                 WHERE shop_domain = p_shop;
  DELETE FROM public.webhook_events            WHERE shop_domain = p_shop;
  DELETE FROM public.daily_rollups             WHERE shop_domain = p_shop;
  DELETE FROM public.product_daily_rollups     WHERE shop_domain = p_shop;
  DELETE FROM public.customers_agg             WHERE shop_domain = p_shop;
  DELETE FROM public.alert_rules               WHERE shop_domain = p_shop;
  DELETE FROM public.alert_state               WHERE shop_domain = p_shop;
  DELETE FROM public.ai_explanations           WHERE shop_domain = p_shop;
  DELETE FROM public.insight_log               WHERE shop_domain = p_shop;
  DELETE FROM public.decision_log              WHERE shop_domain = p_shop;
$$;
