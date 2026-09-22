-- F1-22 — Cache des explications IA (décision 12) : une explication par empreinte (diagnostic +
-- chiffres arrondis + locale). Pas de nouvel appel tant que les faits n'ont pas changé ; expires_at
-- borne la durée de vie. Le texte ne contient que des agrégats (brief §18).
CREATE TABLE IF NOT EXISTS public.ai_explanations (
  shop_domain   TEXT        NOT NULL,
  fingerprint   TEXT        NOT NULL,
  locale        TEXT        NOT NULL,
  text          TEXT        NOT NULL,
  model         TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  PRIMARY KEY (shop_domain, fingerprint, locale)
);

ALTER TABLE public.ai_explanations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_public_access" ON public.ai_explanations;
CREATE POLICY "deny_public_access" ON public.ai_explanations
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_ai_explanations_shop_created ON public.ai_explanations(shop_domain, created_at DESC);
