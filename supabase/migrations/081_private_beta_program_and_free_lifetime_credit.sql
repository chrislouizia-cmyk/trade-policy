-- Trade Police 081: Private Beta applications and FREE lifetime backtest entitlement.
-- Forward-only. Depends on 079 atomic backtest lifecycle and existing HQ permission model.

-- 1) Dedicated HQ permission.
insert into public.staff_permissions(permission_key,description,sensitive)
values ('beta.manage','Review and manage Private Beta access',true)
on conflict(permission_key) do update
set description=excluded.description, sensitive=excluded.sensitive;

insert into public.role_permissions(role,permission_key) values
 ('OWNER','beta.manage'),
 ('HEAD_OF_SALES','beta.manage')
on conflict do nothing;

-- Permission Profile Management (034+) is the authoritative permission path.
-- Backfill beta.manage into existing active OWNER and HEAD_OF_SALES permission profiles.
insert into public.permission_profile_permissions(profile_id, permission_key)
select pp.id, 'beta.manage'
from public.permission_profiles pp
where pp.active = true
  and pp.role_key in ('OWNER', 'HEAD_OF_SALES')
on conflict do nothing;


-- 2) Private Beta application ledger.
create table if not exists public.private_beta_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING','APPROVED','WAITLISTED','REJECTED')),
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text
);

create index if not exists private_beta_applications_status_applied_idx
  on public.private_beta_applications(status, applied_at, id);

alter table public.private_beta_applications enable row level security;
revoke all on table public.private_beta_applications from anon, authenticated;
grant select on table public.private_beta_applications to authenticated;
grant select, insert, update, delete on table public.private_beta_applications to service_role;

drop policy if exists private_beta_applications_select_own on public.private_beta_applications;
create policy private_beta_applications_select_own
  on public.private_beta_applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Preserve every beta tester that existed before this migration.
insert into public.private_beta_applications(
  user_id,status,applied_at,updated_at,reviewed_at,review_note
)
select
  p.id,'APPROVED',coalesce(p.created_at,now()),now(),now(),
  'Existing beta tester preserved by migration 081'
from public.profiles p
where coalesce(p.is_beta_tester,false)=true
on conflict(user_id) do update
set status='APPROVED',
    updated_at=now(),
    reviewed_at=coalesce(public.private_beta_applications.reviewed_at,now()),
    review_note=coalesce(public.private_beta_applications.review_note,'Existing beta tester preserved by migration 081');

-- 3) User-editable profile fields remain editable, but entitlements are server-managed.
create or replace function public.protect_profile_entitlements()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if current_user = 'authenticated'
     and auth.uid() = old.id
     and (
       new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.plan is distinct from old.plan
       or new.subscription_status is distinct from old.subscription_status
       or new.created_at is distinct from old.created_at
       or new.renewal_at is distinct from old.renewal_at
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.trial_started_at is distinct from old.trial_started_at
       or new.is_beta_tester is distinct from old.is_beta_tester
       or new.subscription_price_usd is distinct from old.subscription_price_usd
       or new.last_contacted_at is distinct from old.last_contacted_at
       or new.assigned_sales_user_id is distinct from old.assigned_sales_user_id
     ) then
    raise exception 'Profile entitlements and operational fields are server-managed.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_entitlements on public.profiles;
create trigger profiles_protect_entitlements
before update on public.profiles
for each row execute function public.protect_profile_entitlements();

revoke all on function public.protect_profile_entitlements() from public, anon, authenticated;

-- 3b) Explicit customer profile privileges.
-- Fresh Supabase projects do not automatically grant Data API access to public tables.
-- Customers may read their own row via RLS and update only non-authoritative profile fields.
revoke all on table public.profiles from anon, authenticated;

grant select on table public.profiles to authenticated;

grant update (
  display_name,
  first_name,
  last_name,
  experience_level,
  trader_type,
  profile_completed,
  onboarding_version,
  updated_at
) on table public.profiles to authenticated;

-- 4) Authoritative backtest entitlement resolver.
create or replace function public.backtest_get_plan_code_for_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_plan text;
  v_status text;
  v_beta boolean;
begin
  if p_user_id is null then
    return 'FREE';
  end if;

  if exists (
    select 1 from public.billing_subscriptions bs
    where bs.user_id=p_user_id
      and upper(bs.plan)='FOUNDER'
      and lower(bs.status) in ('active','trialing')
  ) then
    return 'FOUNDER';
  end if;

  select bs.plan, bs.status
    into v_plan, v_status
  from public.billing_subscriptions bs
  where bs.user_id=p_user_id
  order by bs.updated_at desc
  limit 1;

  if lower(coalesce(v_status,'')) in ('active','trialing')
     and upper(coalesce(v_plan,''))='TEAM' then
    return 'TEAM';
  end if;

  select coalesce(p.is_beta_tester,false)
    into v_beta
  from public.profiles p
  where p.id=p_user_id;

  if coalesce(v_beta,false) then
    return 'PRIVATE_BETA';
  end if;

  if lower(coalesce(v_status,'')) in ('active','trialing')
     and upper(coalesce(v_plan,'')) in ('PRO','ELITE') then
    return upper(v_plan);
  end if;

  return 'FREE';
end;
$$;

revoke all on function public.backtest_get_plan_code_for_user(uuid) from public, anon, authenticated;
grant execute on function public.backtest_get_plan_code_for_user(uuid) to service_role;

-- 5) Self-service application/status RPCs.
create or replace function public.private_beta_get_status()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_user_id uuid := auth.uid();
  v_application public.private_beta_applications%rowtype;
  v_approved integer;
  v_beta boolean;
  v_plan text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_application
  from public.private_beta_applications
  where user_id=v_user_id;

  select count(*)::integer into v_approved
  from public.private_beta_applications
  where status='APPROVED';

  select coalesce(is_beta_tester,false) into v_beta
  from public.profiles where id=v_user_id;

  v_plan := public.backtest_get_plan_code_for_user(v_user_id);

  return jsonb_build_object(
    'status', case when v_application.id is null then null else v_application.status end,
    'applied_at', v_application.applied_at,
    'reviewed_at', v_application.reviewed_at,
    'is_beta_tester', coalesce(v_beta,false),
    'plan_code', v_plan,
    'approved_count', v_approved,
    'capacity', 1000,
    'spots_remaining', greatest(0,1000-v_approved)
  );
end;
$$;

create or replace function public.private_beta_apply()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.private_beta_applications%rowtype;
  v_status text;
  v_approved integer;
  v_beta boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if public.backtest_get_plan_code_for_user(v_user_id) not in ('FREE','PRIVATE_BETA') then
    raise exception 'Private Beta applications are available to FREE accounts.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('private-beta-capacity',0));

  select * into v_existing
  from public.private_beta_applications
  where user_id=v_user_id
  for update;

  if v_existing.id is not null then
    return public.private_beta_get_status();
  end if;

  select coalesce(is_beta_tester,false) into v_beta
  from public.profiles where id=v_user_id;

  select count(*)::integer into v_approved
  from public.private_beta_applications
  where status='APPROVED';

  if coalesce(v_beta,false) then
    v_status := 'APPROVED';
  elsif v_approved >= 1000 then
    v_status := 'WAITLISTED';
  else
    v_status := 'PENDING';
  end if;

  insert into public.private_beta_applications(user_id,status,reviewed_at,review_note)
  values(
    v_user_id,
    v_status,
    case when v_status='APPROVED' then now() else null end,
    case when v_status='APPROVED' then 'Existing beta entitlement preserved' else null end
  );

  return public.private_beta_get_status();
end;
$$;

revoke all on function public.private_beta_get_status() from public, anon;
revoke all on function public.private_beta_apply() from public, anon;
grant execute on function public.private_beta_get_status() to authenticated;
grant execute on function public.private_beta_apply() to authenticated;

-- 6) HQ review RPCs. beta.manage is checked inside the SECURITY DEFINER boundary.
create or replace function public.staff_private_beta_queue(
  p_status text default null,
  p_limit integer default 500
)
returns table(
  user_id uuid,
  email text,
  display_name text,
  status text,
  applied_at timestamptz,
  reviewed_at timestamptz,
  review_note text,
  is_beta_tester boolean
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_staff_permission('beta.manage') then
    raise exception 'Private Beta management permission denied.';
  end if;

  return query
  select
    a.user_id,
    p.email,
    p.display_name,
    a.status,
    a.applied_at,
    a.reviewed_at,
    a.review_note,
    coalesce(p.is_beta_tester,false)
  from public.private_beta_applications a
  join public.profiles p on p.id=a.user_id
  where p_status is null or a.status=upper(p_status)
  order by
    case a.status when 'PENDING' then 0 when 'WAITLISTED' then 1 when 'APPROVED' then 2 else 3 end,
    a.applied_at asc
  limit greatest(1,least(coalesce(p_limit,500),1000));
end;
$$;

create or replace function public.staff_private_beta_review(
  p_user_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_decision text := upper(trim(coalesce(p_decision,'')));
  v_application public.private_beta_applications%rowtype;
  v_approved integer;
  v_final_status text;
begin
  if not public.has_staff_permission('beta.manage') then
    raise exception 'Private Beta management permission denied.';
  end if;

  if v_decision not in ('APPROVE','REJECT') then
    raise exception 'Decision must be APPROVE or REJECT.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('private-beta-capacity',0));

  select * into v_application
  from public.private_beta_applications
  where user_id=p_user_id
  for update;

  if v_application.id is null then
    raise exception 'Private Beta application not found.';
  end if;

  if v_decision='APPROVE' then
    select count(*)::integer into v_approved
    from public.private_beta_applications
    where status='APPROVED' and user_id<>p_user_id;

    if v_approved >= 1000 then
      v_final_status := 'WAITLISTED';
      update public.profiles set is_beta_tester=false, updated_at=now() where id=p_user_id;
    else
      v_final_status := 'APPROVED';
      update public.profiles set is_beta_tester=true, updated_at=now() where id=p_user_id;
    end if;
  else
    v_final_status := 'REJECTED';
    update public.profiles set is_beta_tester=false, updated_at=now() where id=p_user_id;
  end if;

  update public.private_beta_applications
     set status=v_final_status,
         reviewed_at=now(),
         reviewed_by=auth.uid(),
         review_note=nullif(trim(coalesce(p_review_note,'')),''),
         updated_at=now()
   where user_id=p_user_id;

  insert into public.admin_access_logs(
    staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success,metadata
  ) values (
    auth.uid(),p_user_id,'REVIEW_PRIVATE_BETA','PRIVATE_BETA_APPLICATION',
    p_user_id::text,'beta.manage',true,
    jsonb_build_object('decision',v_decision,'final_status',v_final_status,'note',p_review_note)
  );

  return jsonb_build_object(
    'user_id',p_user_id,
    'status',v_final_status,
    'is_beta_tester',v_final_status='APPROVED',
    'capacity',1000
  );
end;
$$;

revoke all on function public.staff_private_beta_queue(text,integer) from public, anon;
revoke all on function public.staff_private_beta_review(uuid,text,text) from public, anon;
grant execute on function public.staff_private_beta_queue(text,integer) to authenticated;
grant execute on function public.staff_private_beta_review(uuid,text,text) to authenticated;

-- 7) Existing FREE usage rows now describe the 1-lifetime entitlement.
-- Counters are NOT reset; the reservation ledger remains authoritative.
update public.backtest_usage
set limit_count=1,
    limit_value=1,
    unlimited=false,
    updated_at=now()
where upper(coalesce(plan_code,'FREE'))='FREE';

-- 8) Atomic create remains the only server creation path.
-- FREE counts RESERVED + CONSUMED reservations across the account's entire history.
-- Other finite plans retain the monthly semantics introduced by 079.
create or replace function public.backtest_create_run_atomic(
  p_user_id uuid,
  p_workspace_id uuid,
  p_strategy_profile_id uuid,
  p_strategy_revision_id text,
  p_strategy_snapshot_hash text,
  p_strategy_snapshot_json jsonb,
  p_instrument text,
  p_execution_timeframe text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_starting_balance numeric,
  p_risk_configuration jsonb default '{}'::jsonb,
  p_execution_model jsonb default '{}'::jsonb,
  p_engine_version text default '1.0.0'::text,
  p_data_provider text default 'Twelve Data'::text,
  p_data_revision_fingerprint text default ''::text,
  p_metadata jsonb default '{}'::jsonb,
  p_plan_code text default 'FREE'::text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_plan_code text;
  v_limit integer;
  v_run_id uuid;
  v_existing jsonb;
  v_usage_id uuid;
  v_usage public.backtest_usage%rowtype;
  v_now timestamptz;
  v_period_start_date date;
  v_period_end_date date;
  v_unlimited boolean;
  v_total_used integer;
  v_total_reserved integer;
begin
  if p_user_id is null then
    raise exception 'Backtest user context is required.';
  end if;
  if p_strategy_profile_id is null then
    raise exception 'A strategy profile is required to create a backtest run.';
  end if;
  if p_period_end <= p_period_start then
    raise exception 'Backtest period end must be after start.';
  end if;

  -- Ignore caller-supplied plan claims. Entitlement is resolved from server-managed state.
  v_plan_code := public.backtest_get_plan_code_for_user(p_user_id);
  v_limit := case
    when v_plan_code='FREE' then 1
    when v_plan_code='PRIVATE_BETA' then 10
    when v_plan_code='PRO' then 3
    when v_plan_code='ELITE' then 10
    when v_plan_code='TEAM' then 70
    when v_plan_code='FOUNDER' then null
    else 0
  end;

  v_now := now();
  v_period_start_date := date_trunc('month',v_now)::date;
  v_period_end_date := (date_trunc('month',v_now)+interval '1 month')::date;
  v_unlimited := v_limit is null;

  if v_plan_code='FREE' then
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':FREE:LIFETIME',0));
  else
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_period_start_date::text,0));
  end if;

  if p_idempotency_key is not null then
    select to_jsonb(br) into v_existing
    from public.backtest_runs br
    where br.user_id=p_user_id and br.idempotency_key=p_idempotency_key
    limit 1;

    if v_existing is not null then
      return jsonb_build_object(
        'run_id',v_existing->>'id',
        'status',v_existing->>'status',
        'duplicate',true,
        'idempotency_key',p_idempotency_key,
        'run',v_existing
      );
    end if;
  end if;

  select bu.id into v_usage_id
  from public.backtest_usage bu
  where bu.user_id=p_user_id
    and bu.workspace_id is not distinct from p_workspace_id
    and bu.plan_code=v_plan_code
    and bu.billing_period_start=v_period_start_date
  limit 1;

  if v_usage_id is null then
    insert into public.backtest_usage(
      user_id,workspace_id,plan_code,billing_period_start,billing_period_end,
      used_count,reserved_count,limit_count,unlimited,last_run_id,created_at,updated_at
    ) values (
      p_user_id,p_workspace_id,v_plan_code,v_period_start_date,v_period_end_date,
      0,0,v_limit,v_unlimited,null,v_now,v_now
    )
    returning id into v_usage_id;
  else
    update public.backtest_usage
       set limit_count=v_limit,
           limit_value=coalesce(v_limit,0),
           unlimited=v_unlimited,
           updated_at=v_now
     where id=v_usage_id;
  end if;

  select * into v_usage
  from public.backtest_usage
  where id=v_usage_id
  for update;

  if v_plan_code='FREE' then
    select
      count(*) filter (where r.status='CONSUMED')::integer,
      count(*) filter (where r.status='RESERVED')::integer
    into v_total_used,v_total_reserved
    from public.backtest_credit_reservations r
    join public.backtest_usage bu on bu.id=r.usage_id
    where r.user_id=p_user_id
      and upper(bu.plan_code)='FREE'
      and r.counts_against_limit=true;
  else
    select
      coalesce(sum(bu.used_count),0)::integer,
      coalesce(sum(bu.reserved_count),0)::integer
    into v_total_used,v_total_reserved
    from public.backtest_usage bu
    where bu.user_id=p_user_id
      and bu.plan_code=v_plan_code
      and bu.billing_period_start=v_period_start_date;
  end if;

  v_total_used := coalesce(v_total_used,0);
  v_total_reserved := coalesce(v_total_reserved,0);

  if not v_usage.unlimited and (v_total_used+v_total_reserved)>=v_usage.limit_count then
    raise exception 'Backtest quota exceeded for plan %.',v_plan_code;
  end if;

  insert into public.backtest_runs(
    user_id,workspace_id,strategy_profile_id,strategy_revision_id,
    strategy_snapshot_hash,strategy_snapshot_json,instrument,execution_timeframe,
    period_start,period_end,starting_balance,risk_configuration,execution_model,
    engine_version,data_provider,data_revision_fingerprint,status,failure_reason,
    metadata,idempotency_key,created_at,updated_at
  ) values (
    p_user_id,p_workspace_id,p_strategy_profile_id,p_strategy_revision_id,
    p_strategy_snapshot_hash,p_strategy_snapshot_json,p_instrument,p_execution_timeframe,
    p_period_start,p_period_end,p_starting_balance,p_risk_configuration,p_execution_model,
    p_engine_version,p_data_provider,p_data_revision_fingerprint,'QUEUED',null,
    p_metadata,p_idempotency_key,v_now,v_now
  )
  returning id into v_run_id;

  insert into public.backtest_credit_reservations(
    user_id,run_id,usage_id,period_start,status,counts_against_limit,
    reserved_at,created_at,updated_at
  ) values (
    p_user_id,v_run_id,v_usage_id,v_period_start_date,'RESERVED',not v_unlimited,
    v_now,v_now,v_now
  );

  update public.backtest_usage
     set reserved_count=reserved_count+1,
         last_run_id=v_run_id,
         updated_at=v_now
   where id=v_usage_id;

  return jsonb_build_object(
    'run_id',v_run_id,
    'status','QUEUED',
    'duplicate',false,
    'idempotency_key',p_idempotency_key,
    'usage_id',v_usage_id,
    'used',v_total_used,
    'reserved',v_total_reserved+1,
    'limit',v_limit,
    'remaining',case when v_unlimited then null else v_limit-v_total_used-v_total_reserved-1 end,
    'unlimited',v_unlimited,
    'plan_code',v_plan_code
  );
end;
$$;

revoke all on function public.backtest_create_run_atomic(
  uuid,uuid,uuid,text,text,jsonb,text,text,timestamptz,timestamptz,numeric,
  jsonb,jsonb,text,text,text,jsonb,text,text
) from public, anon, authenticated;
grant execute on function public.backtest_create_run_atomic(
  uuid,uuid,uuid,text,text,jsonb,text,text,timestamptz,timestamptz,numeric,
  jsonb,jsonb,text,text,text,jsonb,text,text
) to service_role;
