create table if not exists public.trader_intelligence_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_key text not null check (char_length(recommendation_key) between 1 and 180),
  version integer not null default 1 check (version > 0),
  category text not null check (category in ('FOUNDATION','REVIEW','PROTECT','DISCIPLINE')),
  priority text not null check (priority in ('HIGH','MEDIUM','FOUNDATION')),
  title text not null check (char_length(title) between 1 and 240),
  detail text not null check (char_length(detail) between 1 and 2000),
  evidence_ids jsonb not null default '[]'::jsonb,
  baseline jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ACKNOWLEDGED','DISMISSED','SUPERSEDED','EVALUATED')),
  outcome jsonb,
  delivered_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,recommendation_key,version)
);

create table if not exists public.trader_intelligence_interventions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null check (stage in ('PRE_TRADE','ACTIVE_TRADE','POST_TRADE')),
  severity text not null check (severity in ('INFO','CAUTION','PAUSE')),
  intervention_key text not null check (char_length(intervention_key) between 1 and 220),
  context_fingerprint text not null check (char_length(context_fingerprint) = 64),
  title text not null check (char_length(title) between 1 and 240),
  detail text not null check (char_length(detail) between 1 and 2000),
  sample_size integer not null default 0 check (sample_size >= 0),
  evidence_ids jsonb not null default '[]'::jsonb,
  status text not null default 'PRESENTED' check (status in ('PRESENTED','ACKNOWLEDGED','DISMISSED','RESOLVED')),
  presented_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id,intervention_key,context_fingerprint)
);

create table if not exists public.trader_intelligence_contributions (
  user_id uuid not null references auth.users(id) on delete cascade,
  dimension text not null check (dimension in ('hour','weekday','instrument','session','discipline')),
  bucket text not null check (char_length(bucket) between 1 and 160),
  trades integer not null check (trades >= 5),
  wins integer not null check (wins >= 0 and wins <= trades),
  total_r numeric not null,
  source_fingerprint text not null check (char_length(source_fingerprint) = 64),
  updated_at timestamptz not null default now(),
  primary key (user_id,dimension,bucket)
);

create table if not exists public.trader_collective_patterns (
  dimension text not null check (dimension in ('hour','weekday','instrument','session','discipline')),
  bucket text not null check (char_length(bucket) between 1 and 160),
  contributor_count integer not null check (contributor_count >= 20),
  trades integer not null check (trades >= 100),
  wins integer not null check (wins >= 0 and wins <= trades),
  losses integer not null check (losses >= 0 and losses <= trades),
  total_r numeric not null,
  average_r numeric not null,
  win_rate numeric not null check (win_rate between 0 and 100),
  confidence_level text not null check (confidence_level in ('OBSERVED','ESTABLISHED')),
  updated_at timestamptz not null default now(),
  primary key (dimension,bucket)
);

create index if not exists trader_intelligence_recommendations_user_status_idx
  on public.trader_intelligence_recommendations(user_id,status,delivered_at desc);
create index if not exists trader_intelligence_interventions_user_time_idx
  on public.trader_intelligence_interventions(user_id,presented_at desc);
create index if not exists trader_intelligence_contributions_dimension_idx
  on public.trader_intelligence_contributions(dimension,bucket);

alter table public.trader_intelligence_recommendations enable row level security;
alter table public.trader_intelligence_interventions enable row level security;
alter table public.trader_intelligence_contributions enable row level security;
alter table public.trader_collective_patterns enable row level security;
alter table public.trader_intelligence_recommendations force row level security;
alter table public.trader_intelligence_interventions force row level security;
alter table public.trader_intelligence_contributions force row level security;
alter table public.trader_collective_patterns force row level security;

revoke all on public.trader_intelligence_recommendations,public.trader_intelligence_interventions,public.trader_intelligence_contributions,public.trader_collective_patterns from public,anon,authenticated;
grant select on public.trader_intelligence_recommendations,public.trader_intelligence_interventions to authenticated;
grant select,insert,update,delete on public.trader_intelligence_recommendations,public.trader_intelligence_interventions,public.trader_intelligence_contributions,public.trader_collective_patterns to service_role;

create policy trader_intelligence_recommendations_read_own
  on public.trader_intelligence_recommendations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy trader_intelligence_interventions_read_own
  on public.trader_intelligence_interventions for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.trader_intelligence_recommendations is
  'Versioned personal coaching recommendations with descriptive before/after measurement.';
comment on table public.trader_intelligence_interventions is
  'Auditable personal context shown around a decision. Never authoritative for trade authorization.';
comment on table public.trader_intelligence_contributions is
  'Server-only, strategy-free aggregates used to build privacy-thresholded collective patterns.';
comment on table public.trader_collective_patterns is
  'Server-only collective patterns requiring at least 20 contributors and 100 recorded trades.';
