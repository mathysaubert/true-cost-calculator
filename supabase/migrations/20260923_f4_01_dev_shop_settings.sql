-- F4-01 — Addendum demandé par la Phase 0 de F4 (arbitrage C6a) : réglage « inclure les commandes
-- de test et brouillons » réservé aux boutiques de développement. Idempotent ; colonnes nullables ou
-- à défaut neutre (false) ; rien de recalculé, aucune donnée modifiée.
-- Rollback : supabase/rollback/20260922_f1_rollback.sql (étape 0b).
--   is_dev_shop         : shop.plan.partnerDevelopment, lu une fois par le Tableau de bord et mémorisé ;
--                         NULL = pas encore lu. Le réglage ci-dessous n'est proposé que si true.
--   include_test_orders : true = les commandes `excluded_reason IN ('draft', 'test')` entrent dans les
--                         KPI (les raisons cancelled, gift_card_only, b2b restent TOUJOURS exclues).
--                         Ignoré si is_dev_shop n'est pas true (jamais actif sur une boutique marchande).
ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS is_dev_shop         BOOLEAN,
  ADD COLUMN IF NOT EXISTS include_test_orders BOOLEAN NOT NULL DEFAULT false;
