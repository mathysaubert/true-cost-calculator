-- Annotations for history data points (Expert feature)
CREATE TABLE IF NOT EXISTS calculation_annotations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  calculation_id TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_domain, calculation_id)
);

CREATE INDEX IF NOT EXISTS idx_calc_annotations_shop ON calculation_annotations(shop_domain);
