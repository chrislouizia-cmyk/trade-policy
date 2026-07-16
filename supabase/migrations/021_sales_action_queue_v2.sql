-- Trade Police V21 — scalable, permission-scoped Sales action queue.
-- `counts` always describes the complete customer population visible to staff
-- who hold BOTH sales.view and customers.view_metadata. `total` and `rows`
-- describe the currently filtered result.
-- Persisted constraints audited in earlier migrations:
-- customer_follow_ups.status: OPEN, COMPLETED, CANCELLED
-- sales_contacts.outcome: NO_RESPONSE, INTERESTED, NEEDS_HELP,
--   FOLLOW_UP_REQUIRED, NOT_INTERESTED, RESOLVED
-- sales_email_drafts.status: DRAFT, READY_FOR_REVIEW, APPROVED, SENT, ARCHIVED
-- Comparisons below normalize with upper(coalesce(...)) for legacy case safety.

create index if not exists customer_follow_ups_status_due_customer_idx on public.customer_follow_ups(status,due_at,customer_user_id);
create index if not exists sales_contacts_customer_contacted_idx on public.sales_contacts(customer_id,contacted_at desc);
create index if not exists sales_email_drafts_customer_status_updated_idx on public.sales_email_drafts(customer_id,status,updated_at desc);
create index if not exists strategy_profiles_active_user_idx on public.strategy_profiles(user_id,is_default) where not coalesce(is_archived,false);
create index if not exists usage_events_customer_activity_idx on public.usage_events(user_id,created_at desc);

drop function if exists public.staff_sales_action_queue_v2(text,integer,integer,text,text,text,text,text,text,text);
create or replace function public.staff_sales_action_queue_v2(
  p_query text default '',
  p_page integer default 1,
  p_page_size integer default 25,
  p_plan text default 'ALL',
  p_lifecycle text default 'ALL',
  p_contact text default 'ALL',
  p_follow_up text default 'ALL',
  p_sort text default 'PRIORITY',
  p_direction text default 'ASC',
  p_activity text default 'ALL'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('sales.view') or not public.has_staff_permission('customers.view_metadata') then
    raise exception 'Sales customer visibility permission denied';
  end if;
  p_page:=greatest(1,p_page); p_page_size:=greatest(1,least(p_page_size,100));
  p_sort:=upper(coalesce(p_sort,'PRIORITY')); p_direction:=upper(coalesce(p_direction,'ASC'));
  if p_sort not in ('PRIORITY','NAME','PLAN','LIFECYCLE','LAST_ACTIVITY','LAST_CONTACT','NEXT_FOLLOW_UP','ANALYSES','ACCOUNTS') then p_sort:='PRIORITY'; end if;
  if p_direction not in ('ASC','DESC') then p_direction:='ASC'; end if;

  with usage_agg as (
    select user_id,max(created_at) last_activity_at,count(*) filter(where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) analysis_count
    from public.usage_events group by user_id
  ), account_agg as (
    select user_id,count(*) filter(where not coalesce(is_archived,false)) account_count,
      string_agg(concat_ws(' ',name,broker),' ') account_search
    from public.trading_accounts group by user_id
  ), strategy_agg as (
    select user_id,count(*) filter(where is_default and not coalesce(is_archived,false)) active_strategy_count,
      max(name) filter(where is_default and not coalesce(is_archived,false)) active_strategy
    from public.strategy_profiles group by user_id
  ), follow_agg as (
    select customer_user_id,
      min(due_at) filter(where upper(coalesce(status,''))='OPEN') next_follow_up_at,
      bool_or(upper(coalesce(status,''))='OPEN' and due_at<date_trunc('day',now())) follow_up_overdue,
      bool_or(upper(coalesce(status,''))='OPEN' and due_at>=date_trunc('day',now()) and due_at<date_trunc('day',now())+interval '1 day') follow_up_today,
      bool_or(upper(coalesce(status,''))='OPEN' and due_at>=date_trunc('day',now())+interval '1 day') follow_up_upcoming,
      bool_or(upper(coalesce(status,''))='COMPLETED') has_completed_follow_up,
      bool_or(upper(coalesce(status,''))='OPEN') has_open_follow_up
    from public.customer_follow_ups group by customer_user_id
  ), contact_agg as (
    select distinct on (customer_id) customer_id,upper(coalesce(contact_type,'OTHER')) contact_type,last_value(upper(coalesce(outcome,''))) over(partition by customer_id order by contacted_at rows between unbounded preceding and unbounded following) latest_outcome,
      max(contacted_at) over(partition by customer_id) last_contacted_at
    from public.sales_contacts order by customer_id,contacted_at desc
  ), draft_agg as (
    select customer_id,count(*) draft_count,(array_agg(upper(coalesce(status,'')) order by updated_at desc))[1] latest_draft_status
    from public.sales_email_drafts group by customer_id
  ), base as (
    select p.id customer_id,coalesce(nullif(p.display_name,''),'Unnamed customer') display_name,p.email,
      case when coalesce(p.is_beta_tester,false) then 'PRIVATE_BETA' else upper(coalesce(p.plan,'FREE')) end plan,
      upper(coalesce(p.subscription_status,'INACTIVE')) subscription_status,p.created_at,p.assigned_sales_user_id,
      u.last_activity_at,coalesce(u.analysis_count,0) analysis_count,coalesce(a.account_count,0) account_count,a.account_search,
      coalesce(s.active_strategy_count,0) active_strategy_count,s.active_strategy,
      coalesce(c.last_contacted_at,p.last_contacted_at) last_contacted_at,c.contact_type,c.latest_outcome,
      f.next_follow_up_at,coalesce(f.follow_up_overdue,false) follow_up_overdue,coalesce(f.follow_up_today,false) follow_up_today,
      coalesce(f.follow_up_upcoming,false) follow_up_upcoming,coalesce(f.has_completed_follow_up,false) has_completed_follow_up,coalesce(f.has_open_follow_up,false) has_open_follow_up,
      coalesce(d.draft_count,0) draft_count,d.latest_draft_status,coalesce(p.is_beta_tester,false) is_beta_tester
    from public.profiles p left join usage_agg u on u.user_id=p.id left join account_agg a on a.user_id=p.id
    left join strategy_agg s on s.user_id=p.id left join follow_agg f on f.customer_user_id=p.id
    left join contact_agg c on c.customer_id=p.id left join draft_agg d on d.customer_id=p.id
  ), classified as (
    select *,case
      -- Product engagement is intentionally evaluated before registration age
      -- or Sales contact state. Contact status is not a lifecycle signal.
      when last_activity_at>=now()-interval '30 days' and analysis_count>=10 and account_count>0 and active_strategy_count>0 then 'RETAINED'
      when last_activity_at>=now()-interval '7 days' and analysis_count>=3 and account_count>0 then 'ENGAGED'
      when last_activity_at>=now()-interval '30 days' and analysis_count>0 and account_count>0 and active_strategy_count>0 then 'ACTIVATED'
      when created_at>=now()-interval '7 days' and analysis_count=0 and account_count=0 and active_strategy_count=0 then 'NEW'
      when active_strategy_count=0 or analysis_count=0 then 'ONBOARDING'
      when last_activity_at>=now()-interval '60 days' then 'AT_RISK'
      else 'DORMANT' end lifecycle,
      case
       when follow_up_overdue then 1 when follow_up_today then 2
       when last_contacted_at is null and created_at>=now()-interval '30 days' then 3
       when is_beta_tester and last_contacted_at is null then 4
       when active_strategy_count=0 then 5 when analysis_count=0 then 6
       when last_activity_at is null or last_activity_at<now()-interval '60 days' then 7 else 8 end priority,
      case
       when follow_up_overdue then 'Follow-up overdue' when follow_up_today then 'Follow-up due today'
       when last_contacted_at is null and created_at>=now()-interval '30 days' then 'Never contacted'
       when is_beta_tester and last_contacted_at is null then 'Beta feedback needed'
       when active_strategy_count=0 then 'No active strategy' when analysis_count=0 then 'No first analysis'
       when last_activity_at is null then 'No recorded activity' when last_activity_at<now()-interval '60 days' then 'Dormant for 60+ days'
       else 'Lifecycle follow-up' end queue_reason,
      case when follow_up_overdue then 'OVERDUE' when follow_up_today then 'DUE_TODAY' when follow_up_upcoming then 'UPCOMING' when has_open_follow_up then 'UPCOMING' when has_completed_follow_up then 'COMPLETED' else 'NONE' end follow_up_status,
      case when last_contacted_at is null then 'NEVER' when latest_outcome is not null then latest_outcome else 'CONTACTED' end contact_status
    from base
  ), filtered as (
    select * from classified where
      (nullif(trim(p_query),'') is null or concat_ws(' ',display_name,email,plan,lifecycle,contact_status,active_strategy,account_search) ilike '%'||trim(p_query)||'%')
      and (upper(coalesce(p_plan,'ALL'))='ALL' or plan=upper(p_plan))
      and (upper(coalesce(p_lifecycle,'ALL'))='ALL' or lifecycle=upper(p_lifecycle))
      and (upper(coalesce(p_contact,'ALL'))='ALL' or contact_status=upper(p_contact) or (upper(p_contact)='FOLLOW_UP_REQUIRED' and latest_outcome='FOLLOW_UP_REQUIRED'))
      and (upper(coalesce(p_follow_up,'ALL'))='ALL' or follow_up_status=upper(p_follow_up))
      and (upper(coalesce(p_activity,'ALL'))='ALL'
        or (upper(p_activity)='ACTIONABLE' and priority<8)
        or (upper(p_activity)='ACTIVE_STRATEGY' and active_strategy_count>0) or (upper(p_activity)='NO_ACTIVE_STRATEGY' and active_strategy_count=0)
        or (upper(p_activity)='HAS_ANALYSES' and analysis_count>0) or (upper(p_activity)='NO_ANALYSES' and analysis_count=0)
        or (upper(p_activity)='BETA' and is_beta_tester))
  ), numbered as (select *,count(*) over() filtered_count from filtered), ordered as (
    select * from numbered order by
      case when p_sort='PRIORITY' and p_direction='ASC' then priority end asc,
      case when p_sort='PRIORITY' and p_direction='DESC' then priority end desc,
      case when p_sort='NAME' and p_direction='ASC' then lower(display_name) end asc,case when p_sort='NAME' and p_direction='DESC' then lower(display_name) end desc,
      case when p_sort='PLAN' and p_direction='ASC' then plan end asc,case when p_sort='PLAN' and p_direction='DESC' then plan end desc,
      case when p_sort='LIFECYCLE' and p_direction='ASC' then lifecycle end asc,case when p_sort='LIFECYCLE' and p_direction='DESC' then lifecycle end desc,
      case when p_sort='LAST_ACTIVITY' and p_direction='ASC' then last_activity_at end asc nulls last,case when p_sort='LAST_ACTIVITY' and p_direction='DESC' then last_activity_at end desc nulls last,
      case when p_sort='LAST_CONTACT' and p_direction='ASC' then last_contacted_at end asc nulls last,case when p_sort='LAST_CONTACT' and p_direction='DESC' then last_contacted_at end desc nulls last,
      case when p_sort='NEXT_FOLLOW_UP' and p_direction='ASC' then next_follow_up_at end asc nulls last,case when p_sort='NEXT_FOLLOW_UP' and p_direction='DESC' then next_follow_up_at end desc nulls last,
      case when p_sort='ANALYSES' and p_direction='ASC' then analysis_count end asc,case when p_sort='ANALYSES' and p_direction='DESC' then analysis_count end desc,
      case when p_sort='ACCOUNTS' and p_direction='ASC' then account_count end asc,case when p_sort='ACCOUNTS' and p_direction='DESC' then account_count end desc,
      next_follow_up_at asc nulls last,last_activity_at desc nulls last,customer_id
    limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(ordered)-'filtered_count') from ordered),'[]'::jsonb),
    'total',coalesce((select max(filtered_count) from numbered),0),'page',p_page,'pageSize',p_page_size,
    'counts',jsonb_build_object(
      'actionable',(select count(*) from classified where priority<8),
      'overdue',(select count(*) from classified where follow_up_status='OVERDUE'),
      'dueToday',(select count(*) from classified where follow_up_status='DUE_TODAY'),
      'neverContacted',(select count(*) from classified where contact_status='NEVER'),
      'drafts',(select coalesce(sum(draft_count),0) from classified),
      'contactedThisWeek',(select count(*) from public.sales_contacts where contacted_at>=date_trunc('week',now())),
      'lifecycle',jsonb_build_object(
        'NEW',(select count(*) from classified where lifecycle='NEW'),
        'ONBOARDING',(select count(*) from classified where lifecycle='ONBOARDING'),
        'ACTIVATED',(select count(*) from classified where lifecycle='ACTIVATED'),
        'ENGAGED',(select count(*) from classified where lifecycle='ENGAGED'),
        'AT_RISK',(select count(*) from classified where lifecycle='AT_RISK'),
        'DORMANT',(select count(*) from classified where lifecycle='DORMANT'),
        'RETAINED',(select count(*) from classified where lifecycle='RETAINED')
      )
    )
  ) into result;
  return result;
end;$$;

revoke all on function public.staff_sales_action_queue_v2(text,integer,integer,text,text,text,text,text,text,text) from public;
grant execute on function public.staff_sales_action_queue_v2(text,integer,integer,text,text,text,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
