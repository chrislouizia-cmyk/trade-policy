-- Additive migration. Existing trading/authorization functions are unchanged.
alter table public.trader_intelligence_profiles add column if not exists daily_brief jsonb not null default '{}'::jsonb,
add column if not exists daily_brief_claimed_at timestamptz,
add column if not exists locale text not null default 'en' check(locale in ('en','es','fr'));

create schema if not exists tp_intelligence_private;
revoke all on schema tp_intelligence_private from public, anon, authenticated;

create table public.trader_intelligence_experiments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hypothesis text not null check(hypothesis in ('OVERRIDE','LATE_SESSION')),
  started_at timestamptz not null default now(),
  timezone text not null default 'UTC',
  baseline_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(baseline_ids)='array'),
  status text not null default 'ACTIVE' check(status in ('ACTIVE','EVALUATED')),
  outcome jsonb,
  evaluated_at timestamptz
);
alter table public.trader_intelligence_experiments enable row level security;
revoke all on public.trader_intelligence_experiments from public,anon,authenticated;
grant select on public.trader_intelligence_experiments to authenticated;
grant all on public.trader_intelligence_experiments to service_role;
create policy intelligence_experiments_owner_read on public.trader_intelligence_experiments
for select to authenticated using((select auth.uid())=user_id);
create unique index intelligence_experiment_active_idx on public.trader_intelligence_experiments(user_id,hypothesis) where status='ACTIVE';
create index intelligence_experiment_history_idx on public.trader_intelligence_experiments(user_id,started_at desc);

create function public.claim_trader_daily_brief(p_user_id uuid,p_day text)
returns boolean language sql security invoker set search_path = '' as $$
  with claimed as (
    insert into public.trader_intelligence_profiles(user_id,daily_brief,daily_brief_claimed_at)
      values(p_user_id,jsonb_build_object('day',p_day,'state','PENDING','generatedAt',now()),now())
    on conflict(user_id) do update set daily_brief=excluded.daily_brief,daily_brief_claimed_at=excluded.daily_brief_claimed_at
      where public.trader_intelligence_profiles.daily_brief->>'day' is distinct from p_day
      and (public.trader_intelligence_profiles.daily_brief_claimed_at is null or public.trader_intelligence_profiles.daily_brief_claimed_at < now()-interval '24 hours')
    returning user_id
  ) select exists(select 1 from claimed);
$$;
revoke all on function public.claim_trader_daily_brief(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_trader_daily_brief(uuid,text) to service_role;

create table public.trader_intelligence_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  collective_opt_in boolean not null default false,
  muted_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(muted_keys) <= 30)
);
alter table public.trader_intelligence_settings enable row level security;
revoke all on public.trader_intelligence_settings from public, anon, authenticated;
grant select on public.trader_intelligence_settings to authenticated;
grant all on public.trader_intelligence_settings to service_role;
create policy intelligence_settings_owner_read on public.trader_intelligence_settings
  for select to authenticated using ((select auth.uid()) = user_id);

create table public.trader_intelligence_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_version bigint not null default 1,
  completed_version bigint not null default 0,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  lease_id uuid,
  retry_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  check (requested_version >= completed_version)
);
alter table public.trader_intelligence_jobs enable row level security;
revoke all on public.trader_intelligence_jobs from public, anon, authenticated;
grant all on public.trader_intelligence_jobs to service_role;
create index intelligence_jobs_pending_idx on public.trader_intelligence_jobs(retry_at, requested_at)
  where requested_version > completed_version;

create function tp_intelligence_private.enqueue_changed_trader()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if TG_TABLE_NAME = 'profiles' then
    owner_id := coalesce(new.id, old.id);
  else
    owner_id := coalesce(new.user_id, old.user_id);
  end if;
  if exists (select 1 from auth.users where id = owner_id) then
    insert into public.trader_intelligence_jobs(user_id) values(owner_id)
    on conflict(user_id) do update set requested_version = public.trader_intelligence_jobs.requested_version + 1,
      requested_at = now(), retry_at = now();
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function tp_intelligence_private.enqueue_changed_trader() from public, anon, authenticated;

create trigger intelligence_event_changed after insert on public.trader_intelligence_events
for each row when (new.event_type in ('ACCOUNT_SEEN','PAGE_VIEW','DECISION_CREATED','TRADE_OPENED','TRADE_CLOSED','TRADE_REANALYZED','INTERVENTION_RESPONDED'))
execute function tp_intelligence_private.enqueue_changed_trader();

create trigger intelligence_trade_changed after insert or update or delete on public.active_trades
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_decision_changed after insert or update or delete on public.decision_reports
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_market_changed after insert on public.market_scans
for each row when (new.server_created is true)
execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_memory_changed after insert or update or delete on public.trader_memories
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_profile_changed after insert or update on public.profiles
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_strategy_changed after insert or update or delete on public.strategy_profiles
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_settings_changed after insert or update or delete on public.trader_intelligence_settings
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_experiment_started after insert on public.trader_intelligence_experiments
for each row execute function tp_intelligence_private.enqueue_changed_trader();
create trigger intelligence_feedback_changed after update on public.trader_intelligence_interventions
for each row when (new.response is distinct from old.response)
execute function tp_intelligence_private.enqueue_changed_trader();

create function public.claim_trader_intelligence_jobs(p_limit integer default 5, p_user_id uuid default null)
returns table(user_id uuid, requested_version bigint, lease_id uuid)
language sql security invoker set search_path = '' as $$
  with candidates as (
    select j.user_id from public.trader_intelligence_jobs j
    where j.requested_version > j.completed_version and j.retry_at <= now()
      and (j.claimed_at is null or j.claimed_at < now() - interval '5 minutes')
      and (p_user_id is null or j.user_id = p_user_id)
    order by j.requested_at limit least(greatest(p_limit,1),10)
    for update skip locked
  )
  update public.trader_intelligence_jobs j set claimed_at=now(), lease_id=gen_random_uuid(), attempts=j.attempts+1
  from candidates c where j.user_id=c.user_id
  returning j.user_id,j.requested_version,j.lease_id;
$$;
revoke all on function public.claim_trader_intelligence_jobs(integer,uuid) from public, anon, authenticated;
grant execute on function public.claim_trader_intelligence_jobs(integer,uuid) to service_role;

create function public.finish_trader_intelligence_job(p_user_id uuid,p_version bigint,p_lease_id uuid,p_success boolean)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.trader_intelligence_jobs set
    completed_version=case when p_success then greatest(completed_version,p_version) else completed_version end,
    claimed_at=null,lease_id=null,
    attempts=case when p_success then 0 else attempts end,
    retry_at=case when p_success then now() else now()+interval '5 minutes' end,
    last_error=case when p_success then null else 'REFRESH_FAILED' end
  where user_id=p_user_id and lease_id=p_lease_id and p_version<=requested_version;
  return found;
end;
$$;
revoke all on function public.finish_trader_intelligence_job(uuid,bigint,uuid,boolean) from public, anon, authenticated;
grant execute on function public.finish_trader_intelligence_job(uuid,bigint,uuid,boolean) to service_role;

create function public.enqueue_daily_trader_intelligence(p_limit integer default 200)
returns integer language plpgsql security invoker set search_path = '' as $$
declare affected integer;
begin
  insert into public.trader_intelligence_jobs(user_id)
    select p.id from public.profiles p
    left join public.trader_intelligence_profiles i on i.user_id=p.id
    where i.last_intraday_refresh_at is null or i.last_intraday_refresh_at < now()-interval '1 day'
    order by i.last_intraday_refresh_at nulls first limit least(greatest(p_limit,1),500)
  on conflict(user_id) do update set requested_version=public.trader_intelligence_jobs.requested_version+1,
    requested_at=now(),retry_at=now();
  get diagnostics affected=row_count;
  return affected;
end;
$$;
revoke all on function public.enqueue_daily_trader_intelligence(integer) from public, anon, authenticated;
grant execute on function public.enqueue_daily_trader_intelligence(integer) to service_role;

-- Seed work, not conclusions. No personal history is copied to a collective pool.
insert into public.trader_intelligence_jobs(user_id) select id from public.profiles on conflict do nothing;
comment on table public.trader_intelligence_jobs is 'Server-only coalescing refresh queue. Leases prevent concurrent claims; material changes during a run remain pending.';
