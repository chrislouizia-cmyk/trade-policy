create table if not exists public.market_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_profile_id uuid null references public.strategy_profiles(id) on delete set null,
  instrument text not null,
  provider text not null,
  timeframes text[] not null default '{}',
  analysis jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.market_scans enable row level security;
grant select,insert,delete on public.market_scans to authenticated;
create policy "market scans are private" on public.market_scans for all to authenticated using (auth.uid()=user_id) with check (auth.uid()=user_id);
create index if not exists market_scans_user_created_idx on public.market_scans(user_id,created_at desc);
