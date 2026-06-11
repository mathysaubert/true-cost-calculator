-- Add explicit deny-all RLS policies to every app table.
--
-- Background: RLS enabled with no policies defaults to deny-all in PostgreSQL,
-- but Supabase's security advisor flags this as ambiguous intent.
-- These policies make it explicit: all data access is server-side via the
-- service role key only. The service role bypasses RLS — these policies have
-- no effect on server-side operations and do not require any app changes.

-- Ensure RLS is enabled on every table (idempotent).
ALTER TABLE public.calculations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.margin_alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calculation_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_plans              ENABLE ROW LEVEL SECURITY;

-- Deny all access from anon and authenticated roles on every table.
CREATE POLICY "deny_public_access" ON public.calculations
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_public_access" ON public.usage
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_public_access" ON public.margin_alerts
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_public_access" ON public.calculation_annotations
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_public_access" ON public.rate_limits
  FOR ALL USING (false) WITH CHECK (false);

CREATE POLICY "deny_public_access" ON public.shop_plans
  FOR ALL USING (false) WITH CHECK (false);
