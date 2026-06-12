-- Add vat_regime preference to shop_plans.
-- 'assujetti' (default) = VAT at import is recoverable, excluded from landed cost.
-- 'franchise' = VAT at import is a hard cost (micro-enterprise / non-registered).
ALTER TABLE public.shop_plans
  ADD COLUMN IF NOT EXISTS vat_regime TEXT NOT NULL DEFAULT 'assujetti';
