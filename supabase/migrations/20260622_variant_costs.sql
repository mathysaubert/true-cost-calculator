-- Brique A — Suivi des coûts : coûts par variante que Shopify ne connaît pas.
-- Alimente engine.js (brique B) avec des intrants réels. AUCUNE marge stockée ici :
-- cette table ne contient que des COÛTS d'entrée + leur provenance.
--
-- source :
--   'estimated' = auto-estimé (unitCost Shopify + mapping catégorie + réglages boutique)
--                 → toute marge calculée dessus doit porter un marqueur « coûts estimés ».
--   'confirmed' = validé manuellement par le marchand dans l'UI.
--   'imported'  = renseigné via import CSV.
CREATE TABLE IF NOT EXISTS public.variant_costs (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain    TEXT        NOT NULL,
  variant_id     TEXT        NOT NULL,
  product_id     TEXT,
  prix_achat     NUMERIC     NOT NULL DEFAULT 0,
  port_entrant   NUMERIC     NOT NULL DEFAULT 0,
  qty_par_lot    INTEGER     NOT NULL DEFAULT 1,
  cout_emballage NUMERIC     NOT NULL DEFAULT 0,
  vat_regime     TEXT        NOT NULL DEFAULT 'assujetti',
  shipping_model TEXT        NOT NULL DEFAULT 'dropshipping',
  pays_import    TEXT        NOT NULL DEFAULT 'Chine',
  categorie      TEXT        NOT NULL DEFAULT 'Autre',
  source         TEXT        NOT NULL DEFAULT 'estimated',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_domain, variant_id)
);

ALTER TABLE public.variant_costs ENABLE ROW LEVEL SECURITY;

-- Deny-all : tout accès se fait côté serveur via la service role (qui bypass RLS),
-- cohérent avec les autres tables (cf. 20260611_rls_policies.sql).
-- DROP IF EXISTS d'abord : CREATE POLICY n'est pas idempotent → rend le fichier ré-exécutable.
DROP POLICY IF EXISTS "deny_public_access" ON public.variant_costs;
CREATE POLICY "deny_public_access" ON public.variant_costs
  FOR ALL USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_variant_costs_shop ON public.variant_costs(shop_domain);

-- Réglage boutique : pays d'import par défaut dont héritent les nouvelles variantes.
-- 'Chine' n'est que la valeur initiale, pas une constante figée : le marchand la règle
-- une fois, et chaque variante peut ensuite être surchargée individuellement.
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS default_import_country TEXT NOT NULL DEFAULT 'Chine';
