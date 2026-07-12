-- CPA prescriptif — CPA blended ACTUEL déclaré par le marchand (repère, jamais mesuré par l'app).
-- Sert à l'écart « plafond − déclaré » dans le monitor. Saisi dans la devise de la BOUTIQUE
-- (feesCurrency, dérivée d'order_margins.currency_code) — le label du champ l'indique explicitement.
-- current_cpa NULL = jamais renseigné (distinct de 0 = « je ne dépense rien », une déclaration).
-- current_cpa_updated_at : date de déclaration (affichée « déclaré le … » + obsolescence à 30 j).
--   Remis à NULL en même temps que current_cpa quand le marchand efface le champ (pas de date orpheline).
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS current_cpa            NUMERIC,
  ADD COLUMN IF NOT EXISTS current_cpa_updated_at TIMESTAMPTZ;
