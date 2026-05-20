-- Feature 2: add product info + all fee parameters to calculations
ALTER TABLE calculations
  ADD COLUMN IF NOT EXISTS product_id    TEXT,
  ADD COLUMN IF NOT EXISTS product_title TEXT,
  ADD COLUMN IF NOT EXISTS shopify_fee   DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS stripe_fee    DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS returns_rate  DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS ads_rate      DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS customs_rate  DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS cout_rendu    DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS marge_brute_percent DECIMAL(5,2);

CREATE INDEX IF NOT EXISTS idx_calculations_product ON calculations(shop_domain, product_title);
