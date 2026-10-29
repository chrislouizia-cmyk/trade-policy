-- Owner command center: one permission-scoped, canonical source for executive
-- metrics, cross-department attention, and recent company activity.

create or replace function public.staff_owner_command_center()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_owner() or not public.has_staff_permission('hq.view') then
    raise exception 'Owner command center permission denied';
  end if;

  select jsonb_build_object(
    'generatedAt',now(),
    'metrics',jsonb_build_object(
      'totalCustomers',(select count(*) from public.profiles p where not exists(select 1 from public.staff_roles sr where sr.user_id=p.id)),
      'newCustomers30d',(select count(*) from public.profiles p where p.created_at>=now()-interval '30 days' and not exists(select 1 from public.staff_roles sr where sr.user_id=p.id)),
      'activeCustomers7d',(select count(distinct u.user_id) from public.usage_events u where u.created_at>=now()-interval '7 days' and not exists(select 1 from public.staff_roles sr where sr.user_id=u.user_id)),
      'analysesToday',(select count(*) from public.usage_events u where u.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') and u.created_at>=date_trunc('day',now())),
      'openTrades',(select count(*) from public.active_trades t where upper(t.status)='OPEN' and not exists(select 1 from public.staff_roles sr where sr.user_id=t.user_id)),
      'activeStrategies',(select count(*) from public.strategy_profiles s where not coalesce(s.is_archived,false) and not exists(select 1 from public.staff_roles sr where sr.user_id=s.user_id)),
      'openSupport',(select count(*) from public.support_tickets where status in ('OPEN','WAITING_CUSTOMER')),
      'openFeedback',(select count(*) from public.beta_feedback where status in ('OPEN','REVIEWING')),
      'openCompliance',(select count(*) from public.compliance_cases where status not in ('RESOLVED','DISMISSED','CLOSED')),
      'openIncidents',(select count(*) from public.system_incidents where resolved_at is null and status not in ('RESOLVED','IGNORED')),
      'failedActionsToday',(select count(*) from public.usage_events where not success and created_at>=date_trunc('day',now())),
      'overdueFollowUps',(select count(*) from public.sales_leads where stage not in ('CONVERTED','LOST') and next_follow_up_at<now())
    ),
    'attention',coalesce((
      select jsonb_agg(item order by priority_rank,occurred_at desc)
      from (
        select * from (
        select jsonb_build_object(
          'kind','INCIDENT','id',i.id::text,'priority',i.severity,
          'title',coalesce(nullif(i.message,''),i.public_code),
          'detail',concat_ws(' · ',i.category,coalesce(i.provider,i.endpoint,'Internal')),
          'occurredAt',i.last_detected_at,'dueAt',null,'href','/hq/system/queue'
        ) item,
        case i.severity when 'CRITICAL' then 1 when 'HIGH' then 2 when 'WARNING' then 4 else 6 end priority_rank,
        i.last_detected_at occurred_at
        from public.system_incidents i
        where i.resolved_at is null and i.status not in ('RESOLVED','IGNORED')

        union all

        select jsonb_build_object(
          'kind','COMPLIANCE','id',c.id::text,'priority',c.severity,
          'title',c.title,'detail',concat_ws(' · ',c.case_type,coalesce(p.display_name,p.email,'No customer subject')),
          'occurredAt',c.created_at,'dueAt',c.due_at,'href','/hq/compliance/cases/'||c.id::text
        ),
        case c.severity when 'CRITICAL' then 1 when 'HIGH' then 2 when 'MEDIUM' then 3 when 'WARNING' then 4 else 6 end,
        c.created_at
        from public.compliance_cases c left join public.profiles p on p.id=c.customer_user_id
        where c.status not in ('RESOLVED','DISMISSED','CLOSED')

        union all

        select jsonb_build_object(
          'kind','SUPPORT','id',t.id::text,'priority',t.priority,
          'title',t.subject,'detail',concat_ws(' · ',coalesce(p.display_name,p.email,'Customer'),t.status),
          'occurredAt',t.updated_at,'dueAt',null,'href','/hq/support'
        ),
        case t.priority when 'URGENT' then 1 when 'HIGH' then 2 when 'NORMAL' then 4 else 6 end,
        t.updated_at
        from public.support_tickets t left join public.profiles p on p.id=t.customer_user_id
        where t.status in ('OPEN','WAITING_CUSTOMER')

        union all

        select jsonb_build_object(
          'kind','SALES','id',l.id::text,'priority','OVERDUE',
          'title','Follow up with '||coalesce(l.display_name,l.email),
          'detail',concat_ws(' · ',l.stage,l.source),
          'occurredAt',l.updated_at,'dueAt',l.next_follow_up_at,'href','/hq/sales'
        ),2,l.updated_at
        from public.sales_leads l
        where l.stage not in ('CONVERTED','LOST') and l.next_follow_up_at<now()
        ) candidates order by priority_rank,occurred_at desc limit 12
      ) queue
    ),'[]'::jsonb),
    'activity',coalesce((
      select jsonb_agg(item order by occurred_at desc)
      from (
        select * from (
        select jsonb_build_object(
          'kind','CUSTOMER','title','Customer joined',
          'detail',coalesce(p.display_name,p.email,'Unnamed customer'),
          'occurredAt',p.created_at,'href','/hq/customers/'||p.id::text
        ) item,p.created_at occurred_at
        from public.profiles p
        where not exists(select 1 from public.staff_roles sr where sr.user_id=p.id)

        union all

        select jsonb_build_object(
          'kind','CUSTOMER_ACTIVITY','title','Customer activity',
          'detail',concat_ws(' · ',coalesce(p.display_name,p.email,'Customer'),u.event_type,coalesce(u.instrument,'')),
          'occurredAt',u.created_at,'href','/hq/customers/'||u.user_id::text
        ),u.created_at
        from (
          select distinct on (user_id) user_id,event_type,instrument,created_at
          from public.usage_events
          where user_id is not null
          order by user_id,created_at desc
        ) u join public.profiles p on p.id=u.user_id
        where not exists(select 1 from public.staff_roles sr where sr.user_id=u.user_id)

        union all

        select jsonb_build_object(
          'kind','STAFF','title',replace(a.action,'_',' '),
          'detail',concat_ws(' · ',a.resource_type,a.resource_id),
          'occurredAt',a.created_at,
          'href',case when a.customer_user_id is not null then '/hq/customers/'||a.customer_user_id::text else '/hq' end
        ),a.created_at
        from public.admin_access_logs a
        ) events order by occurred_at desc limit 16
      ) timeline
    ),'[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.staff_owner_command_center() from public,anon;
grant execute on function public.staff_owner_command_center() to authenticated;
notify pgrst,'reload schema';
