-- F1-24 — Addendum demandé par la Phase 0 de F3 (arbitrages A3, A4, A9) : réglages que le moteur
-- lit et que F1 n'avait pas. Idempotent ; colonnes nullables ou avec défaut neutre ; rien de
-- recalculé. Rollback : supabase/rollback/20260922_f1_rollback.sql (mis à jour).
--   shipping_cost_rules      : { default, byCountry: { FR: 5.9 }, confirmed } — port MARCHAND par pays
--                              (A3) ; vide = repli « port facturé au client », marqué à confirmer.
--   packaging_cost_per_order : emballage PAR COMMANDE (A4) ; cout_emballage de variant_costs devient
--                              une surcharge optionnelle par unité.
--   return_cost_per_return   : frais de traitement d'un retour (CM2, brief §7 « frais de retour »).
--   shop_country_code        : pays de la boutique (shop.billingAddress.countryCode, rempli à la
--                              première sync F2) → UE/hors UE et taux de TVA d'import (A8/A9).
ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS shipping_cost_rules      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS packaging_cost_per_order NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS return_cost_per_return   NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS shop_country_code        CHAR(2);
