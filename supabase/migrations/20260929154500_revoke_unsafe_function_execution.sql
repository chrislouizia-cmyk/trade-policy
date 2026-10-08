-- Trigger and event-trigger functions are internal implementation details and
-- must not be callable through PostgREST. Also quarantine the unrelated
-- Sanchita seeding function that is present in this project's database: do not
-- drop it or its data here, but remove all client execution privileges.

revoke all on function public.handle_new_user()
from public, anon, authenticated;

revoke all on function public.protect_profile_billing_fields()
from public, anon, authenticated;

revoke all on function public.rls_auto_enable()
from public, anon, authenticated;

revoke all on function public.seed_sanchita_menu_complete(jsonb, jsonb)
from public, anon, authenticated;

comment on function public.seed_sanchita_menu_complete(jsonb, jsonb) is
  'Quarantined from Trade Police client roles; retained temporarily for separate contamination cleanup review.';

notify pgrst, 'reload schema';
