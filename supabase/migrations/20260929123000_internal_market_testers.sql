create table if not exists public.internal_market_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.internal_market_testers enable row level security;
alter table public.internal_market_testers force row level security;

revoke all on table public.internal_market_testers from public, anon, authenticated;

create or replace function public.has_internal_market_test_access()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      exists (
        select 1
        from public.internal_market_testers tester
        where tester.user_id = auth.uid()
          and tester.enabled = true
      )
      or public.current_staff_role() is not null
    )
$$;

revoke all on function public.has_internal_market_test_access() from public, anon;
grant execute on function public.has_internal_market_test_access() to authenticated;

drop policy if exists "instrument_catalog_read" on public.instrument_catalog;
create policy "instrument_catalog_read" on public.instrument_catalog
  for select to authenticated
  using (
    is_active = true
    and (
      metadata->>'availability' = 'AVAILABLE'
      or (
        metadata->>'availability' = 'INTERNAL_TEST_ONLY'
        and (select public.has_internal_market_test_access())
      )
    )
  );

comment on table public.internal_market_testers is
  'Explicit client-portal accounts authorized for closed internal market-data testing. This entitlement does not grant staff or HQ access.';

comment on function public.has_internal_market_test_access() is
  'Returns true for active staff or explicitly enabled internal market testers without exposing the tester allowlist.';
