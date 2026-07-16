-- Trade Police v16: restore customer visibility and make Sales operational.
-- Run after 013_customer_360_hq_staff_invitations.sql.

-- A person is a customer when a customer profile exists. HQ-only employees invited
-- through the Admin API do not receive a profile, so a staff role must not hide a
-- legitimate trader profile owned by the same identity.
drop function if exists public.staff_customer_directory(integer);
create function public.staff_customer_directory(p_limit integer default 100)
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
)
language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('customers.view_metadata') then
    raise exception 'Customer metadata permission denied';
  end if;

  return query
  select
    p.id,
    p.email,
    p.display_name,
    upper(coalesce(p.plan,'FREE')),
    upper(coalesce(p.subscription_status,'INACTIVE')),
    p.created_at,
    (select count(*) from public.strategy_profiles sp where sp.user_id=p.id and coalesce(sp.is_archived,false)=false),
    (select count(*) from public.trading_accounts ta where ta.user_id=p.id and coalesce(ta.is_archived,false)=false),
    (select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    (select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id)
  from public.profiles p
  order by p.created_at desc
  limit greatest(1,least(p_limit,500));
end;$$;
revoke all on function public.staff_customer_directory(integer) from public;
grant execute on function public.staff_customer_directory(integer) to authenticated;

create or replace function public.staff_customer_360(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('customers.view_metadata') then
    raise exception 'Customer metadata permission denied';
  end if;

  select jsonb_build_object(
    'customer_id',p.id,
    'email',p.email,
    'display_name',p.display_name,
    'phone',p.phone,
    'discord_handle',p.discord_handle,
    'plan',upper(coalesce(p.plan,'FREE')),
    'subscription_status',upper(coalesce(p.subscription_status,'INACTIVE')),
    'trial_started_at',p.trial_started_at,
    'trial_ends_at',p.trial_ends_at,
    'renewal_at',p.renewal_at,
    'created_at',p.created_at,
    'strategy_count',(select count(*) from public.strategy_profiles sp where sp.user_id=p.id and coalesce(sp.is_archived,false)=false),
    'account_count',(select count(*) from public.trading_accounts ta where ta.user_id=p.id and coalesce(ta.is_archived,false)=false),
    'analysis_count',(select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    'last_activity_at',(select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id),
    'timeline',coalesce((
      select jsonb_agg(x order by (x->>'created_at')::timestamptz desc)
      from (
        select jsonb_build_object('type','NOTE','title','Internal note','detail',cn.note,'created_at',cn.created_at) x
        from public.customer_notes cn where cn.customer_user_id=p.id
        union all
        select jsonb_build_object('type','FOLLOW_UP','title','Follow-up · '||cf.channel,'detail',coalesce(cf.summary,cf.status),'created_at',cf.created_at) x
        from public.customer_follow_ups cf where cf.customer_user_id=p.id
        union all
        select jsonb_build_object('type','TICKET','title','Support ticket · '||st.subject,'detail',st.status||' · '||coalesce(st.priority,'NORMAL'),'created_at',st.created_at) x
        from public.support_tickets st where st.customer_user_id=p.id
      ) timeline_rows
    ),'[]'::jsonb)
  ) into result
  from public.profiles p
  where p.id=p_customer_id;

  return result;
end;$$;
revoke all on function public.staff_customer_360(uuid) from public;
grant execute on function public.staff_customer_360(uuid) to authenticated;

-- One actionable queue used by the Sales workspace. Priority is deterministic:
-- overdue follow-ups, payment/expiry attention, trials, inactive customers, then healthy customers.
create or replace function public.staff_sales_operational_queue(p_limit integer default 250)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('sales.view') then
    raise exception 'Sales workspace permission denied';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.priority desc, q.due_at nulls last, q.created_at desc),'[]'::jsonb)
  into result
  from (
    select
      'CUSTOMER'::text as item_type,
      p.id,
      p.display_name,
      p.email,
      p.phone,
      p.discord_handle,
      upper(coalesce(p.plan,'FREE')) as plan,
      upper(coalesce(p.subscription_status,'INACTIVE')) as status,
      case
        when exists(select 1 from public.customer_follow_ups f where f.customer_user_id=p.id and f.status='OPEN' and f.due_at < now()) then 'Follow-up is overdue'
        when upper(coalesce(p.subscription_status,'')) in ('PAST_DUE','PAYMENT_FAILED','EXPIRED','CANCELLED') then 'Subscription needs commercial attention'
        when p.renewal_at is not null and p.renewal_at <= now()+interval '7 days' then 'Subscription renews within 7 days'
        when upper(coalesce(p.subscription_status,''))='TRIAL' and p.trial_ends_at is not null and p.trial_ends_at <= now()+interval '3 days' then 'Trial expires within 3 days'
        when upper(coalesce(p.subscription_status,''))='TRIAL' then 'Customer is evaluating Trade Police'
        when coalesce((select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id),p.created_at) < now()-interval '14 days' then 'Customer has been inactive for 14+ days'
        when upper(coalesce(p.subscription_status,''))='ACTIVE' then 'Active subscriber relationship'
        else 'New or inactive customer to qualify'
      end as reason,
      case
        when exists(select 1 from public.customer_follow_ups f where f.customer_user_id=p.id and f.status='OPEN' and f.due_at < now()) then 100
        when upper(coalesce(p.subscription_status,'')) in ('PAST_DUE','PAYMENT_FAILED','EXPIRED','CANCELLED') then 95
        when p.renewal_at is not null and p.renewal_at <= now()+interval '7 days' then 85
        when upper(coalesce(p.subscription_status,''))='TRIAL' and p.trial_ends_at is not null and p.trial_ends_at <= now()+interval '3 days' then 80
        when upper(coalesce(p.subscription_status,''))='TRIAL' then 70
        when coalesce((select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id),p.created_at) < now()-interval '14 days' then 65
        when upper(coalesce(p.subscription_status,''))='ACTIVE' then 30
        else 50
      end::integer as priority,
      (select min(f.due_at) from public.customer_follow_ups f where f.customer_user_id=p.id and f.status='OPEN') as due_at,
      (select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id) as last_activity_at,
      p.created_at,
      (select f.assigned_to from public.customer_follow_ups f where f.customer_user_id=p.id and f.status='OPEN' order by f.due_at limit 1) as assigned_to
    from public.profiles p

    union all

    select
      'LEAD'::text as item_type,
      l.id,
      l.display_name,
      l.email,
      null::text as phone,
      null::text as discord_handle,
      null::text as plan,
      upper(l.stage) as status,
      case
        when l.next_follow_up_at is not null and l.next_follow_up_at < now() then 'Lead follow-up is overdue'
        when l.stage='NEW' then 'New lead has not been contacted'
        when l.stage='CONTACTED' then 'Continue the sales conversation'
        when l.stage='TRIAL' then 'Lead entered a trial'
        when l.stage='QUALIFIED' then 'Qualified lead is ready for a decision'
        else 'Open sales lead'
      end as reason,
      case
        when l.next_follow_up_at is not null and l.next_follow_up_at < now() then 100
        when l.stage='QUALIFIED' then 85
        when l.stage='TRIAL' then 80
        when l.stage='NEW' then 75
        else 60
      end::integer as priority,
      l.next_follow_up_at as due_at,
      null::timestamptz as last_activity_at,
      l.created_at,
      l.assigned_to
    from public.sales_leads l
    where l.stage not in ('CONVERTED','LOST')
  ) q
  limit greatest(1,least(p_limit,500));

  return result;
end;$$;
revoke all on function public.staff_sales_operational_queue(integer) from public;
grant execute on function public.staff_sales_operational_queue(integer) to authenticated;

-- Normalize workspace summary counts regardless of historical lowercase values.
create or replace function public.staff_workspace_overview()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r text; result jsonb;
begin
  select role into r from public.staff_roles where user_id=auth.uid() and is_active=true;
  if r is null then raise exception 'Staff permission denied'; end if;
  update public.staff_roles set last_active_at=now() where user_id=auth.uid();
  if r='HEAD_OF_SALES' then
    select jsonb_build_object(
      'role',r,
      'new_customers_30d',(select count(*) from public.profiles where created_at>=now()-interval '30 days'),
      'trial_customers',(select count(*) from public.profiles where upper(coalesce(subscription_status,''))='TRIAL'),
      'active_subscriptions',(select count(*) from public.profiles where upper(coalesce(subscription_status,''))='ACTIVE'),
      'open_leads',(select count(*) from public.sales_leads where stage not in ('CONVERTED','LOST')),
      'converted_leads',(select count(*) from public.sales_leads where stage='CONVERTED')
    ) into result;
  elsif r in ('COMPLIANCE_OFFICER','SECURITY_ADMIN') then
    select jsonb_build_object('role',r,'open_cases',(select count(*) from public.compliance_cases where status in ('OPEN','REVIEWING')),'high_priority',(select count(*) from public.compliance_cases where status in ('OPEN','REVIEWING') and severity in ('HIGH','CRITICAL')),'open_incidents',(select count(*) from public.system_incidents where resolved_at is null),'audit_events_7d',(select count(*) from public.admin_access_logs where created_at>=now()-interval '7 days')) into result;
  elsif r='SUPPORT' then
    select jsonb_build_object('role',r,'open_tickets',(select count(*) from public.support_tickets where status in ('OPEN','WAITING_CUSTOMER')),'assigned_to_me',(select count(*) from public.support_tickets where assigned_staff_user_id=auth.uid() and status in ('OPEN','WAITING_CUSTOMER')),'open_feedback',(select count(*) from public.beta_feedback where status in ('OPEN','REVIEWING')),'customers',(select count(*) from public.profiles)) into result;
  elsif r='TECHNICIAN' then
    select jsonb_build_object('role',r,'open_incidents',(select count(*) from public.system_incidents where resolved_at is null),'critical_incidents',(select count(*) from public.system_incidents where resolved_at is null and severity='CRITICAL'),'failed_actions_today',(select count(*) from public.usage_events where success=false and created_at>=date_trunc('day',now())),'analyses_today',(select count(*) from public.usage_events where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') and created_at>=date_trunc('day',now()))) into result;
  else
    result:=public.admin_overview() || jsonb_build_object('role',r);
  end if;
  return result;
end;$$;
revoke all on function public.staff_workspace_overview() from public;
grant execute on function public.staff_workspace_overview() to authenticated;

insert into public.release_notes(version,title,summary,items,published,published_at)
values(
  '1.2.0-operational-sales',
  'Operational Sales and Customer Directory',
  'Sales metrics now reveal actionable people and customer profiles remain visible when a trader also has an internal role.',
  '["Clickable Sales queues","Customer directory restoration","Customer 360 restoration","Normalized subscription states","More resilient HQ invitation configuration"]'::jsonb,
  true,
  now()
)
on conflict(version) do update set summary=excluded.summary,items=excluded.items,published=true,published_at=now();
