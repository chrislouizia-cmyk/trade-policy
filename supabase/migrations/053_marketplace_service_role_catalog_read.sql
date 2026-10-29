-- Forward-only fix: re-grant the minimum service-role read access required by the HQ Marketplace catalog route.
-- This intentionally does not modify 050 and does not weaken RLS or public access.

grant select on table public.marketplace_listings to service_role;
grant select on table public.marketplace_strategy_releases to service_role;
grant select on table public.marketplace_release_rankings to service_role;

-- Current server code for the HQ Marketplace catalog only reads the catalog tables above.
-- marketplace_installs and marketplace_review_events remain restricted to the existing internal app paths and user-scoped access.

notify pgrst,'reload schema';
