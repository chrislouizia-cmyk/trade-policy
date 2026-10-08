-- Forward-only fix: grant the minimum service-role read access required by the HQ staff directory.
-- This intentionally does not alter 054 and does not widen access to anon/authenticated.

grant select on table public.staff_roles to service_role;

notify pgrst,'reload schema';
