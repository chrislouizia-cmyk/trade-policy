-- Marketplace Foundation Phase 1A. This migration is intentionally data-only:
-- no active-strategy, analysis, validation, trade, billing, or UI path reads it.

create table if not exists public.marketplace_strategy_releases (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  source_strategy_id uuid not null references public.strategy_profiles(id) on delete restrict,
  source_strategy_revision_id text not null,
  release_version integer not null check (release_version > 0),
  snapshot_fingerprint text not null check (snapshot_fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot_json jsonb not null,
  created_at timestamptz not null default now(),
  unique(source_strategy_id, source_strategy_revision_id),
  unique(source_strategy_id, release_version)
);

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null unique references public.marketplace_strategy_releases(id) on delete restrict,
  visibility text not null default 'INTERNAL' check (visibility = 'INTERNAL'),
  review_status text not null default 'DRAFT' check (review_status in ('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED')),
  sanitized_metadata jsonb not null default '{}'::jsonb,
  display_price_cents integer not null default 3000 check (display_price_cents = 3000),
  creator_share_cents integer not null default 1500 check (creator_share_cents = 1500),
  platform_share_cents integer not null default 1500 check (platform_share_cents = 1500),
  commerce_enabled boolean not null default false check (commerce_enabled = false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (creator_share_cents + platform_share_cents = display_price_cents)
);

create table if not exists public.marketplace_installs (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.marketplace_strategy_releases(id) on delete restrict,
  installer_user_id uuid not null references auth.users(id) on delete cascade,
  installed_strategy_id uuid unique references public.strategy_profiles(id) on delete set null,
  entitlement_mode text not null default 'SIMULATED_INTERNAL' check (entitlement_mode = 'SIMULATED_INTERNAL'),
  charged_cents integer not null default 0 check (charged_cents = 0),
  status text not null default 'INSTALLED' check (status in ('INSTALLED','REVOKED')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(release_id, installer_user_id)
);

create table if not exists public.marketplace_release_rankings (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.marketplace_strategy_releases(id) on delete restrict,
  score_version text not null,
  calculation_window_start timestamptz,
  calculation_window_end timestamptz,
  performance_score numeric,
  marketplace_readiness_score numeric,
  rank_position integer check (rank_position > 0),
  input_summary jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now()
);

create table if not exists public.marketplace_review_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.marketplace_strategy_releases(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_scope text not null check (actor_scope in ('FOUNDER','SALES','COMPLIANCE','SYSTEM')),
  event_type text not null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.strategy_profiles add column if not exists marketplace_source_release_id uuid references public.marketplace_strategy_releases(id) on delete set null;
alter table public.strategy_profiles add column if not exists marketplace_install_id uuid references public.marketplace_installs(id) on delete set null;
alter table public.market_scans add column if not exists marketplace_release_id uuid references public.marketplace_strategy_releases(id) on delete set null;
alter table public.decision_reports add column if not exists marketplace_release_id uuid references public.marketplace_strategy_releases(id) on delete set null;
alter table public.active_trades add column if not exists marketplace_release_id uuid references public.marketplace_strategy_releases(id) on delete set null;

create index if not exists marketplace_releases_creator_idx on public.marketplace_strategy_releases(creator_user_id, created_at desc);
create index if not exists marketplace_installs_user_idx on public.marketplace_installs(installer_user_id, created_at desc);
create index if not exists marketplace_rankings_release_idx on public.marketplace_release_rankings(release_id, calculated_at desc);

create or replace function public.reject_marketplace_release_mutation() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Marketplace releases are immutable'; end; $$;
drop trigger if exists marketplace_release_immutable_update on public.marketplace_strategy_releases;
drop trigger if exists marketplace_release_immutable_delete on public.marketplace_strategy_releases;
create trigger marketplace_release_immutable_update before update on public.marketplace_strategy_releases for each row execute function public.reject_marketplace_release_mutation();
create trigger marketplace_release_immutable_delete before delete on public.marketplace_strategy_releases for each row execute function public.reject_marketplace_release_mutation();
drop trigger if exists marketplace_ranking_append_only_update on public.marketplace_release_rankings;
drop trigger if exists marketplace_ranking_append_only_delete on public.marketplace_release_rankings;
create trigger marketplace_ranking_append_only_update before update on public.marketplace_release_rankings for each row execute function public.reject_marketplace_release_mutation();
create trigger marketplace_ranking_append_only_delete before delete on public.marketplace_release_rankings for each row execute function public.reject_marketplace_release_mutation();
drop trigger if exists marketplace_review_append_only_update on public.marketplace_review_events;
drop trigger if exists marketplace_review_append_only_delete on public.marketplace_review_events;
create trigger marketplace_review_append_only_update before update on public.marketplace_review_events for each row execute function public.reject_marketplace_release_mutation();
create trigger marketplace_review_append_only_delete before delete on public.marketplace_review_events for each row execute function public.reject_marketplace_release_mutation();

alter table public.marketplace_strategy_releases enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_installs enable row level security;
alter table public.marketplace_release_rankings enable row level security;
alter table public.marketplace_review_events enable row level security;
revoke all on public.marketplace_strategy_releases,public.marketplace_listings,public.marketplace_installs,public.marketplace_release_rankings,public.marketplace_review_events from public,anon,authenticated;
grant select on public.marketplace_installs to authenticated;
create policy "marketplace installs select own" on public.marketplace_installs for select to authenticated using ((select auth.uid())=installer_user_id);

notify pgrst,'reload schema';
