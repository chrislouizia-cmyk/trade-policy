-- Forward-only fix: grant the minimum service-role read access required by the Founder profile selector.
-- This intentionally does not alter customer access, RLS policies, 053, or 054.

grant select on table public.strategy_profiles to service_role;

notify pgrst,'reload schema';
