-- Fiabilité perçue des taux de douane : statut de CLASSIFICATION douanière par variante.
-- Le taux TARIC dépend de la CATÉGORIE choisie ; tant que le marchand ne l'a pas VALIDÉE, elle est
-- une ESTIMATION. Ce flag est ORTHOGONAL à `source` (provenance des COÛTS) : une ligne confirmed/
-- imported peut porter une classification encore estimée — c'est le cas nominal du risque (le marchand
-- saisit ses coûts sans jamais regarder la catégorie auto-devinée).
--
-- DEFAULT false = « estimée » pour TOUTES les lignes existantes et nouvelles → migration NON destructive,
-- aucun recalcul déclenché. Seule l'action confirm_customs_category le met à true (un seul UPDATE, sur
-- toutes les variantes d'un produit). Tout AUTRE chemin qui CHANGE la catégorie (costs_save, costs_import_csv)
-- le remet à false — invalidation APPLICATIVE (customsClassification.js), pas de trigger SQL caché.
ALTER TABLE public.variant_costs
  ADD COLUMN IF NOT EXISTS customs_confirmed BOOLEAN NOT NULL DEFAULT false;
