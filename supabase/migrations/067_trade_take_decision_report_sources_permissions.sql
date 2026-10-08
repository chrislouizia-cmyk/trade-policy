-- Minimal read privilege required by the authenticated trade-override validation path.
-- RLS remains enabled and the policy is owner-scoped to the authenticated user only.
grant select
on table public.decision_report_sources
to authenticated;

create policy "decision report sources select own"
on public.decision_report_sources
for select to authenticated
using ((select auth.uid()) = user_id);

comment on table public.decision_report_sources is 'Authenticated users may only read rows that the owner-scoped RLS policy allows; this does not broaden writes or disable row-level security.';
