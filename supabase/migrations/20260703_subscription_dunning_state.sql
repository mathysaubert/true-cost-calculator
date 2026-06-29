-- Dunning — récupération de churn involontaire (abonnement frozen). État PAR BOUTIQUE
-- (1 ligne par shop) pour appliquer cadence + plafond + arrêt propre du cron de relance.
-- AUCUNE décision ici : la logique (send/resolved/stop/nothing) vit dans app/lib/dunning.js
-- (pure, testée). Cette table ne stocke que des FAITS de relance.
--
-- last_status     : dernier statut d'abonnement LU au cron (frozen|active|cancelled|pending|…).
-- dunning_count   : relances envoyées dans l'épisode frozen COURANT (reset à 0 au retour active).
-- last_dunning_at : date du dernier mail de relance → cadence (n'envoyer que si ≥ ~3 j).
-- frozen_since    : début de l'épisode frozen (info mail/debug).
-- Garde-fou G2 (cron) : dunning_count/last_dunning_at avancés UNIQUEMENT après envoi réussi.
CREATE TABLE IF NOT EXISTS public.subscription_dunning_state (
  shop_domain     TEXT        NOT NULL UNIQUE,
  last_status     TEXT,
  dunning_count   INTEGER     NOT NULL DEFAULT 0,
  last_dunning_at TIMESTAMPTZ,
  frozen_since    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subscription_dunning_state ENABLE ROW LEVEL SECURITY;

-- Deny-all : accès serveur uniquement via service role (bypass RLS), comme les autres états.
-- DROP IF EXISTS d'abord : CREATE POLICY n'est pas idempotent → fichier ré-exécutable.
DROP POLICY IF EXISTS "deny_public_access" ON public.subscription_dunning_state;
CREATE POLICY "deny_public_access" ON public.subscription_dunning_state
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_sds_shop ON public.subscription_dunning_state(shop_domain);
