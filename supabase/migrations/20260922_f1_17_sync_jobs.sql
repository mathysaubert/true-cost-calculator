-- F1-17 — Jobs de synchronisation : évolution d'order_sync_state (1 ligne par boutique) vers une
-- file de jobs (1 ligne par job : fenêtre, curseur, op bulk, statut, tentatives). Un job = un message
-- (décision 19 : dispatcher sur cron Vercel en V1, file externe plus tard sans changer le format).
-- order_sync_state est CONSERVÉE (le code en production la lit) ; ses lignes sont copiées ici une
-- fois (idempotent). Elle sera supprimée avec le code qui bascule (F2).
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id                 UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain        TEXT        NOT NULL,
  kind               TEXT        NOT NULL CHECK (kind IN (
                       'orders_backfill', 'orders_incremental', 'refunds', 'returns', 'fulfillments',
                       'inventory', 'fees', 'ads_meta', 'ads_google', 'ads_tiktok', 'gsc', 'shopifyql', 'rollups')),
  window_start       TIMESTAMPTZ,
  window_end         TIMESTAMPTZ,
  cursor             TEXT,
  bulk_operation_id  TEXT,
  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  attempts           INTEGER     NOT NULL DEFAULT 0,
  last_error         TEXT,
  payload            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.sync_jobs;
CREATE POLICY "deny_public_access" ON public.sync_jobs
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_shop_kind_status ON public.sync_jobs(shop_domain, kind, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_dispatch         ON public.sync_jobs(status, created_at);

-- Copie unique de l'état de sync existant (une boutique déjà copiée n'est pas dupliquée).
INSERT INTO public.sync_jobs (shop_domain, kind, window_start, bulk_operation_id, status, finished_at)
SELECT
  o.shop_domain,
  'orders_backfill',
  o.window_start,
  o.bulk_operation_id,
  CASE o.status WHEN 'running' THEN 'running' WHEN 'failed' THEN 'failed' ELSE 'completed' END,
  o.last_backfill_at
FROM public.order_sync_state o
WHERE NOT EXISTS (
  SELECT 1 FROM public.sync_jobs s
  WHERE s.shop_domain = o.shop_domain AND s.kind = 'orders_backfill'
);
