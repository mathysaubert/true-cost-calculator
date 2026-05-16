-- True Cost Calculator — table des calculs
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- Projet : https://atoagwrganzqjzrycxwb.supabase.co

CREATE TABLE IF NOT EXISTS calculations (
  id              UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain     TEXT          NOT NULL,
  purchase_price  DECIMAL(10,2) NOT NULL,
  selling_price   DECIMAL(10,2) NOT NULL,
  category        TEXT          NOT NULL,
  country         TEXT          NOT NULL,
  net_margin_percent DECIMAL(6,2) NOT NULL,
  net_margin_euros   DECIMAL(10,2) NOT NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Row Level Security activé.
-- Le service key (côté serveur) bypass RLS — aucune donnée n'est accessible
-- via la clé publique depuis le navigateur.
ALTER TABLE calculations ENABLE ROW LEVEL SECURITY;

-- Index pour les requêtes fréquentes (par boutique, par date)
CREATE INDEX IF NOT EXISTS calculations_shop_domain_idx
  ON calculations (shop_domain);

CREATE INDEX IF NOT EXISTS calculations_created_at_idx
  ON calculations (created_at DESC);
