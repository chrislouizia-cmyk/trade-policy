-- Forward-only fix: grant the minimum service-role read access required by the Marketplace publish snapshot path.
-- This intentionally does not change customer access, RLS policies, or any existing migration.

grant select on table public.strategy_instruments to service_role;

notify pgrst,'reload schema';
