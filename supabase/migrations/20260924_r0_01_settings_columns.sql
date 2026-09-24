-- R0-01 (S-01) — Réglages : colonnes manquantes sur shop_settings (arbitrages S7 et S8 du 2026-09-24).
-- Idempotent ; colonnes NULLABLES sans défaut : rien de pré-rempli (S6), aucune donnée modifiée.
-- Rollback : supabase/rollback/20260924_r0_rollback.sql.
--   main_product_price : prix du produit principal, LU par econ/aggregate.js et la règle
--                        aov_vs_main_price depuis F3 mais jamais créé (bug latent : règle muette en prod).
--   sales_countries, shipping_countries, supply_countries : codes ISO-2 (onboarding PDF, S8) ;
--                        informatifs en R1, consommés plus tard (TVA par pays de vente, coût rendu).
--   report_locale      : langue des rapports (PDF) ; locale_override reste la langue de l'admin.
ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS main_product_price  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS sales_countries     TEXT[],
  ADD COLUMN IF NOT EXISTS shipping_countries  TEXT[],
  ADD COLUMN IF NOT EXISTS supply_countries    TEXT[],
  ADD COLUMN IF NOT EXISTS report_locale       TEXT;
