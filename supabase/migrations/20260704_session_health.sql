-- Entretien des sessions mortes — santé des tokens offline PAR BOUTIQUE (1 ligne par shop).
-- Alimentée par le cron reaper (api.cron.session_reaper.jsx) : à chaque probe admin,
--   succès              → consecutive_failures remis à 0 (last_success_at).
--   admin_unauthorized  → consecutive_failures++ (et first_failure_at fixé si absent).
-- La décision de suppression (shouldReapSession, pure/testée) lit ces faits ; on ne supprime
-- JAMAIS sur un seul run (401 transitoire rafraîchissable = 401 désinstallé, indistinguables).
-- On ne compte QUE l'échec d'acquisition admin (throw unauthenticated.admin), jamais une erreur
-- d'opération (ex. bulk ACCESS_DENIED sur une session pourtant vivante).
CREATE TABLE IF NOT EXISTS public.session_health (
  shop_domain          TEXT        NOT NULL UNIQUE,
  consecutive_failures INTEGER     NOT NULL DEFAULT 0,
  first_failure_at     TIMESTAMPTZ,   -- début de la série d'échecs courante (null si en succès)
  last_failure_at      TIMESTAMPTZ,
  last_success_at      TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.session_health ENABLE ROW LEVEL SECURITY;

-- Deny-all : accès serveur uniquement via service role (bypass RLS), comme les autres états.
-- DROP IF EXISTS d'abord : CREATE POLICY n'est pas idempotent → fichier ré-exécutable.
DROP POLICY IF EXISTS "deny_public_access" ON public.session_health;
CREATE POLICY "deny_public_access" ON public.session_health
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_session_health_shop ON public.session_health(shop_domain);
