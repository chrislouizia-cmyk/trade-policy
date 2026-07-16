-- Trade Police v19: beta release operations, CRM, incident resolution and analytics.

alter table public.profiles add column if not exists is_beta_tester boolean not null default false;
alter table public.profiles add column if not exists subscription_price_usd numeric not null default 0;
alter table public.profiles add column if not exists renewal_at timestamptz;
alter table public.profiles add column if not exists last_contacted_at timestamptz;
alter table public.profiles add column if not exists assigned_sales_user_id uuid references auth.users(id) on delete set null;

update public.profiles
set plan = case
  when upper(coalesce(plan,'')) in ('PRIVATE_BETA','BETA','FREE') then 'FREE'
  when upper(coalesce(plan,'')) in ('PRO','PRO_10','10') then 'PRO'
  when upper(coalesce(plan,'')) in ('PREMIUM','PREMIUM_20','20') then 'PREMIUM'
  else coalesce(nullif(upper(plan),''),'FREE') end,
    is_beta_tester = is_beta_tester or upper(coalesce(plan,'')) in ('PRIVATE_BETA','BETA');

create or replace function public.staff_sales_customer_crm(p_limit integer default 500)
returns table(
  customer_id uuid,email text,display_name text,plan text,subscription_status text,
  is_beta_tester boolean,subscription_price_usd numeric,created_at timestamptz,
  last_activity_at timestamptz,analysis_count bigint,strategy_count bigint,account_count bigint,
  renewal_at timestamptz,last_contacted_at timestamptz,assigned_sales_user_id uuid
) language plpgsql security definer set search_path=public as $$
begin
  if not (public.has_staff_permission('sales.view') or public.has_staff_permission('sales.manage') or public.has_staff_permission('customers.view_metadata')) then
    raise exception 'Staff permission denied';
  end if;
  return query
  select p.id,p.email,coalesce(nullif(p.display_name,''),'Unnamed customer'),
    coalesce(nullif(upper(p.plan),''),'FREE'),upper(coalesce(p.subscription_status,'INACTIVE')),
    coalesce(p.is_beta_tester,false),coalesce(p.subscription_price_usd,0),p.created_at,
    greatest(
      (select max(u.created_at) from public.usage_events u where u.user_id=p.id),
      (select max(a.updated_at) from public.active_trades a where a.user_id=p.id),
      p.created_at
    ),
    (select count(*) from public.usage_events u where u.user_id=p.id and u.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    (select count(*) from public.strategy_profiles s where s.user_id=p.id and s.is_archived=false),
    (select count(*) from public.trading_accounts a where a.user_id=p.id and a.is_archived=false),
    p.renewal_at,p.last_contacted_at,p.assigned_sales_user_id
  from public.profiles p
  order by p.created_at desc
  limit greatest(1,least(p_limit,2000));
end;$$;
revoke all on function public.staff_sales_customer_crm(integer) from public;
grant execute on function public.staff_sales_customer_crm(integer) to authenticated;

create or replace function public.staff_mark_customer_contacted(p_customer_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('sales.manage') then raise exception 'Sales manage permission denied'; end if;
  update public.profiles set last_contacted_at=now(),assigned_sales_user_id=coalesce(assigned_sales_user_id,auth.uid()) where id=p_customer_id;
end;$$;
revoke all on function public.staff_mark_customer_contacted(uuid) from public;
grant execute on function public.staff_mark_customer_contacted(uuid) to authenticated;

create or replace function public.staff_system_operations()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not (public.has_staff_permission('system.health') or public.is_owner()) then raise exception 'System permission denied'; end if;
  select jsonb_build_object(
    'open_incidents',(select count(*) from public.system_incidents where resolved_at is null),
    'critical_incidents',(select count(*) from public.system_incidents where resolved_at is null and severity='CRITICAL'),
    'failed_actions_today',(select count(*) from public.usage_events where success=false and created_at>=date_trunc('day',now())),
    'analyses_today',(select count(*) from public.usage_events where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') and created_at>=date_trunc('day',now())),
    'top_instruments',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select instrument as name,count(*) as count from public.usage_events where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') and instrument is not null group by instrument order by count(*) desc limit 10)x),
    'top_customers',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select p.id,p.email,coalesce(p.display_name,'Unnamed customer') display_name,count(*) as count from public.usage_events u join public.profiles p on p.id=u.user_id where u.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') group by p.id,p.email,p.display_name order by count(*) desc limit 10)x),
    'feature_usage',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select event_type as name,count(*) as count from public.usage_events where created_at>=now()-interval '30 days' group by event_type order by count(*) desc limit 12)x)
  ) into result;
  return result;
end;$$;
revoke all on function public.staff_system_operations() from public;
grant execute on function public.staff_system_operations() to authenticated;

create or replace function public.staff_resolve_system_incident(p_incident_id bigint)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not (public.has_staff_permission('system.health') or public.is_owner()) then raise exception 'System permission denied'; end if;
  update public.system_incidents set resolved_at=now() where id=p_incident_id;
end;$$;
revoke all on function public.staff_resolve_system_incident(bigint) from public;
grant execute on function public.staff_resolve_system_incident(bigint) to authenticated;
