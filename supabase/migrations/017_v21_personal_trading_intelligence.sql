-- Trade Police V21 — Personal Trading Intelligence

alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;
alter table public.profiles add column if not exists experience_level text;
alter table public.profiles add column if not exists trader_type text;
alter table public.profiles add column if not exists profile_completed boolean not null default false;
alter table public.profiles add column if not exists onboarding_version integer not null default 1;

alter table public.strategy_profiles add column if not exists trading_style text not null default 'day-trading';
alter table public.strategy_profiles add column if not exists minimum_holding_minutes integer not null default 15;
alter table public.strategy_profiles add column if not exists strategy_methodologies jsonb not null default '[]'::jsonb;
alter table public.strategy_profiles add column if not exists personal_rules jsonb not null default '[]'::jsonb;
alter table public.strategy_profiles add column if not exists ai_behavior jsonb not null default '{"tone":"analytical","strictness":"conservative","confidenceThreshold":80,"explainDecisions":true,"suggestAlternatives":true,"useDisplayName":true}'::jsonb;

alter table public.strategy_stop_limits add column if not exists minimum_value numeric not null default 0;
alter table public.strategy_stop_limits add column if not exists preferred_value numeric;

create index if not exists profiles_completion_idx on public.profiles(profile_completed, created_at desc);

update public.profiles
set profile_completed = true,
    onboarding_version = 2
where coalesce(first_name,'') <> '' and coalesce(last_name,'') <> '';
