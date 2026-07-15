-- Trade Police v11: production control, private operational telemetry and owner dashboard.

alter table public.staff_roles drop constraint if exists staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_check
  check (role in ('OWNER','SUPPORT','TECHNICIAN','SECURITY_ADMIN'));

create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  endpoint text,
  instrument text,
  success boolean not null default true,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.system_incidents (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  public_code text not null,
  internal_code text not null,
  provider text,
  endpoint text,
  severity text not null default 'WARNING' check (severity in ('INFO','WARNING','HIGH','CRITICAL')),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_created_idx on public.usage_events(created_at desc);
create index if not exists usage_events_user_idx on public.usage_events(user_id, created_at desc);
create index if not exists system_incidents_created_idx on public.system_incidents(created_at desc);
create index if not exists system_incidents_open_idx on public.system_incidents(created_at desc) where resolved_at is null;

alter table public.usage_events enable row level security;
alter table public.system_incidents enable row level security;
revoke all on public.usage_events from anon, authenticated;
revoke all on public.system_incidents from anon, authenticated;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.staff_roles where user_id=auth.uid() and role='OWNER' and is_active=true)
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to authenticated;

create or replace function public.log_usage_event(
  p_event_type text,
  p_endpoint text default null,
  p_instrument text default null,
  p_success boolean default true,
  p_duration_ms integer default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.usage_events(user_id,event_type,endpoint,instrument,success,duration_ms,metadata)
  values(auth.uid(),p_event_type,p_endpoint,p_instrument,p_success,p_duration_ms,coalesce(p_metadata,'{}'::jsonb));
end;$$;
revoke all on function public.log_usage_event(text,text,text,boolean,integer,jsonb) from public;
grant execute on function public.log_usage_event(text,text,text,boolean,integer,jsonb) to authenticated;

create or replace function public.log_system_incident(
  p_public_code text,
  p_internal_code text,
  p_provider text default null,
  p_endpoint text default null,
  p_severity text default 'WARNING',
  p_message text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.system_incidents(user_id,public_code,internal_code,provider,endpoint,severity,message,metadata)
  values(auth.uid(),p_public_code,p_internal_code,p_provider,p_endpoint,p_severity,p_message,coalesce(p_metadata,'{}'::jsonb));
end;$$;
revoke all on function public.log_system_incident(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.log_system_incident(text,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.admin_overview()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v jsonb;
begin
  if not public.is_owner() then raise exception 'Owner permission denied'; end if;
  select jsonb_build_object(
    'total_customers',(select count(*) from public.profiles),
    'new_customers_30d',(select count(*) from public.profiles where created_at >= now()-interval '30 days'),
    'active_customers_7d',(select count(distinct user_id) from public.usage_events where created_at >= now()-interval '7 days'),
    'analyses_today',(select count(*) from public.usage_events where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') and created_at >= date_trunc('day',now())),
    'failed_actions_today',(select count(*) from public.usage_events where success=false and created_at >= date_trunc('day',now())),
    'open_trades',(select count(*) from public.active_trades where status='OPEN'),
    'strategies',(select count(*) from public.strategy_profiles where is_archived=false),
    'open_feedback',(select count(*) from public.beta_feedback where status in ('OPEN','REVIEWING')),
    'open_incidents',(select count(*) from public.system_incidents where resolved_at is null),
    'plans',(select coalesce(jsonb_object_agg(plan,c), '{}'::jsonb) from (select plan,count(*) c from public.profiles group by plan) q)
  ) into v;
  return v;
end;$$;
revoke all on function public.admin_overview() from public;
grant execute on function public.admin_overview() to authenticated;

create or replace function public.admin_customers(p_limit integer default 100)
returns table(
  customer_id uuid,
  email text,
  display_name text,
  plan text,
  subscription_status text,
  created_at timestamptz,
  strategy_count bigint,
  account_count bigint,
  analysis_count bigint,
  last_activity_at timestamptz
) language plpgsql security definer set search_path=public as $$
begin
  if not public.is_owner() then raise exception 'Owner permission denied'; end if;
  return query
  select p.id,p.email,p.display_name,p.plan,p.subscription_status,p.created_at,
    (select count(*) from public.strategy_profiles s where s.user_id=p.id and s.is_archived=false),
    (select count(*) from public.trading_accounts a where a.user_id=p.id and a.is_archived=false),
    (select count(*) from public.usage_events u where u.user_id=p.id and u.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    (select max(u.created_at) from public.usage_events u where u.user_id=p.id)
  from public.profiles p order by p.created_at desc limit greatest(1,least(p_limit,500));
end;$$;
revoke all on function public.admin_customers(integer) from public;
grant execute on function public.admin_customers(integer) to authenticated;

create or replace function public.admin_recent_incidents(p_limit integer default 50)
returns setof public.system_incidents language plpgsql security definer set search_path=public as $$
begin
  if not public.is_owner() then raise exception 'Owner permission denied'; end if;
  return query select * from public.system_incidents order by created_at desc limit greatest(1,least(p_limit,200));
end;$$;
revoke all on function public.admin_recent_incidents(integer) from public;
grant execute on function public.admin_recent_incidents(integer) to authenticated;
