-- Marketplace constitutional security hardening.
-- Internal helpers must not be callable directly by client roles.

revoke all on function
  public.marketplace_normalize_strategy_profile_for_revision(uuid)
from public, anon, authenticated;

grant execute on function
  public.marketplace_normalize_strategy_profile_for_revision(uuid)
to service_role;

revoke all on function
  public.marketplace_canonicalize_jsonb(jsonb)
from public, anon, authenticated;

grant execute on function
  public.marketplace_canonicalize_jsonb(jsonb)
to service_role;

revoke all on function
  public.marketplace_attach_licensed_strategy_snapshot()
from public, anon, authenticated;

revoke all on function
  public.reject_marketplace_release_mutation()
from public, anon, authenticated;

notify pgrst, 'reload schema';
