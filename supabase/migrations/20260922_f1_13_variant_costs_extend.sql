-- F1-13 — variant_costs étendue (aucune colonne existante touchée ; product_id reste nullable,
-- décision a : correction à la première sync en F2). Les colonnes existantes port_entrant /
-- qty_par_lot / cout_emballage restent la source du port entrant et de l'emballage (pas de doublon).
--   supplier_lead_days + buffer_days : point de commande = ventes/jour × (délai + tampon) (10.11).
--   duty_rate_pct : taux de droits saisi pour un import HORS UE (décision 7, formule générique) ;
--   landed_cost_override : coût rendu saisi directement quand le marchand ignore son taux (décision 7).
--   L'UE reste calculée par engine.js (TARIC) : ces deux colonnes y sont ignorées.
ALTER TABLE public.variant_costs
  ADD COLUMN IF NOT EXISTS supplier_lead_days    INTEGER,
  ADD COLUMN IF NOT EXISTS buffer_days           INTEGER,
  ADD COLUMN IF NOT EXISTS duty_rate_pct         NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS landed_cost_override  NUMERIC(14,2);

CREATE INDEX IF NOT EXISTS idx_variant_costs_shop_product ON public.variant_costs(shop_domain, product_id);
