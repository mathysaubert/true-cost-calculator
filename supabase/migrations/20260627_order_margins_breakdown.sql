-- Brique B (persistance) — fige la sortie complète de computeMargin PAR LIGNE.
-- AUCUNE marge calculée en SQL : on stocke un JSON déjà produit par engine.js à
-- l'ingestion (ou rejoué au backfill depuis les intrants figés, auto-validé au centime).
-- Permettra, plus tard et EN LECTURE PURE, le waterfall poste-par-poste (douane, TVA
-- import, frais Shopify/Stripe en €) et le gate de la note TVA collectée — sans jamais
-- rejouer le moteur côté client.
--
-- Forme du JSON (postes PAR UNITÉ, clés = noms moteur, aucun poste inventé) :
--   { revenu, coutRendu, douane, tvaImport, tvaNetCost,
--     shopifyCost, stripeCost, retoursCost, adsCost, fraisFixes,
--     customsRate, vatRate, shop_taxes_included }
-- Identité réconciliée au centime (cf. engine.js) :
--   revenu − coutRendu − shopifyCost − stripeCost − retoursCost − adsCost − fraisFixes
--   = unit_net_margin (déjà stocké).
--
-- NULL = ligne ingérée AVANT cette version, pas encore rétro-remplie par le backfill
-- (action backfill_breakdowns) → l'UI affiche un fallback, jamais un waterfall vide.
ALTER TABLE public.order_margins
  ADD COLUMN IF NOT EXISTS margin_breakdown_json JSONB;

-- RLS : la policy deny_public_access (FOR ALL) de 20260622_order_margins.sql couvre déjà
-- toute colonne ; rien à ajouter. Accès serveur uniquement via service role (bypass RLS).
