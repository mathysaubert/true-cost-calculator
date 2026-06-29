-- Seuil de rentabilité configurable (extension de l'alerting produit-à-perte).
-- Le marchand fixe un POURCENTAGE global boutique : l'alerte se déclenche quand la marge
-- nette cumulée d'un produit passe SOUS ce seuil (pas seulement sous zéro).
--
-- Frontière (profitabilityAlert.js, pure) : sous_le_seuil ⟺ net_margin < (T/100) × net_revenue.
--   • T = 0  → net_margin < 0 : EXACTEMENT le comportement legacy (perte stricte), aucune /0.
--   • T = 15 → net_margin < 15 % du CA net.
-- DEFAULT 0 → AUCUNE régression : tout marchand n'ayant rien réglé garde la perte stricte.
-- Aucun renommage d'état : last_state reste 'profitable'|'loss' (la frontière change, pas le
-- vocabulaire) → zéro migration des lignes product_profitability_state existantes.
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS profitability_threshold_pct NUMERIC NOT NULL DEFAULT 0;
