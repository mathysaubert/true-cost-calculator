-- F1-03 — order_margins ÉTENDUE EN PLACE (décision 17), PAS renommée : le code en production y
-- écrit encore (upsert PostgREST) ; le renommage en order_lines viendra en F2 avec le code.
-- Contrat d'immuabilité : toutes les colonnes ajoutées sont NULLABLES et SANS DEFAULT non nul —
-- aucun snapshot existant n'est réécrit, la clé unique (shop_domain, order_id, line_item_id) et
-- l'idempotence ON CONFLICT DO NOTHING restent intactes. Le backfill 24 mois (F2) remplira ces
-- colonnes ligne par ligne, uniquement sur les lignes qu'il insère.
ALTER TABLE public.order_margins
  ADD COLUMN IF NOT EXISTS unit_price_ht     NUMERIC(14,2),   -- prix unitaire HT depuis taxLines (plus d'hypothèse de taux)
  ADD COLUMN IF NOT EXISTS tax_lines         JSONB,           -- lignes de taxe Shopify figées
  ADD COLUMN IF NOT EXISTS is_gift_card      BOOLEAN,         -- ligne carte cadeau : exclue des KPI (brief §9)
  ADD COLUMN IF NOT EXISTS cm1_components    JSONB,           -- {achat, port_entrant, droits, tva_import_non_recup} figés
  ADD COLUMN IF NOT EXISTS cm1_unit          NUMERIC(14,2),   -- CM1 par unité, figé
  ADD COLUMN IF NOT EXISTS cm2_alloc         JSONB,           -- {emballage, paiement, port_marchand} alloués à la ligne
  ADD COLUMN IF NOT EXISTS breakdown_version INTEGER,         -- version du moteur ayant produit le snapshot
  ADD COLUMN IF NOT EXISTS day_local         DATE;            -- jour boutique figé (e)

CREATE INDEX IF NOT EXISTS idx_order_margins_shop_product ON public.order_margins(shop_domain, product_id);
CREATE INDEX IF NOT EXISTS idx_order_margins_shop_day     ON public.order_margins(shop_domain, day_local);
