-- The session-aware activation overload introduced in migration 088 runs as
-- SECURITY INVOKER. Its caller is service_role, so it needs explicit access
-- to the columns used to verify and persist the original trading session.
-- Keep this column-scoped: browser roles must not receive table privileges.

grant select (id, user_id, session)
  on table public.trade_records
  to service_role;

grant update (session, updated_at)
  on table public.trade_records
  to service_role;
