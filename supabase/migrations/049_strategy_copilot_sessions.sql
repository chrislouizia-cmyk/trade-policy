create table if not exists public.strategy_copilot_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  unresolved_questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.strategy_copilot_sessions enable row level security;
create policy "users manage their copilot sessions" on public.strategy_copilot_sessions for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
