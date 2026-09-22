-- F1-16 — Connexions externes (Meta, Google Ads, TikTok, Search Console), une par boutique et par
-- fournisseur. Jetons CHIFFRÉS côté application (AES-256-GCM, app/lib/crypto.server.js, clé
-- TOKEN_ENCRYPTION_KEY dans l'env Vercel — décision 20) : la base ne voit jamais un jeton en clair.
-- *_token_enc = base64(iv | tag | chiffré). Déconnexion = révocation chez le fournisseur + statut
-- 'revoked' + jetons mis à NULL (brief §16).
CREATE TABLE IF NOT EXISTS public.integration_connections (
  shop_domain            TEXT        NOT NULL,
  provider               TEXT        NOT NULL CHECK (provider IN ('meta', 'google_ads', 'tiktok', 'search_console')),
  status                 TEXT        NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  external_account_id    TEXT,
  external_account_name  TEXT,
  access_token_enc       TEXT,
  refresh_token_enc      TEXT,
  token_expires_at       TIMESTAMPTZ,
  scopes                 TEXT[]      NOT NULL DEFAULT '{}',
  config                 JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- ex. propriété GSC, fenêtre d'attribution choisie
  last_sync_at           TIMESTAMPTZ,
  last_error             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_domain, provider)
);

ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.integration_connections;
CREATE POLICY "deny_public_access" ON public.integration_connections
  FOR ALL USING (false) WITH CHECK (false);
