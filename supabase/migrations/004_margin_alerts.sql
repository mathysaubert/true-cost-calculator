-- Feature 4: margin alert thresholds per shop
CREATE TABLE IF NOT EXISTS margin_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain  TEXT NOT NULL UNIQUE,
  threshold    DECIMAL(5,2) NOT NULL DEFAULT 25.00,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE margin_alerts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_margin_alerts_shop ON margin_alerts(shop_domain);
