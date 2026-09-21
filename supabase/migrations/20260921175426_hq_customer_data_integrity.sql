-- HQ customer data integrity: keep metadata separate from trading data, exclude
-- staff identities, make Customer 360 operational, and use permission profiles
-- as the only authority for Support feedback work.

create or replace function public.staff_customer_directory_v2(
  p_query text default '',
  p_page integer default 1,
  p_page_size integer default 25,
  p_sort text default 'last_activity',
  p_direction text default 'desc'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare result jsonb; can_view_trading boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('customers.view_metadata') then
    raise exception 'Customer metadata permission denied';
  end if;
  can_view_trading:=public.has_staff_permission('customers.view_trading');
  if p_sort not in ('name','plan','last_activity','account_count','analysis_count','status') then p_sort:='last_activity'; end if;
  if lower(p_direction) not in ('asc','desc') then p_direction:='desc'; end if;
  if not can_view_trading and p_sort in ('account_count','analysis_count') then p_sort:='last_activity'; end if;
  p_page:=greatest(1,p_page); p_page_size:=greatest(1,least(p_page_size,1000));

  with strategy_agg as (
    select user_id,count(*) filter(where not coalesce(is_archived,false)) strategy_count,
      max(name) filter(where is_default and not coalesce(is_archived,false)) active_strategy
    from public.strategy_profiles where can_view_trading group by user_id
  ), account_agg as (
    select user_id,count(*) filter(where not coalesce(is_archived,false)) account_count,
      string_agg(coalesce(name,'')||' '||coalesce(broker,''),' ') account_search
    from public.trading_accounts where can_view_trading group by user_id
  ), usage_agg as (
    select user_id,count(*) filter(where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) analysis_count,
      max(created_at) last_activity_at
    from public.usage_events group by user_id
  ), trade_agg as (
    select user_id,count(*) filter(where status='OPEN') open_trades,
      count(*) filter(where status='CLOSED') closed_trades
    from public.active_trades where can_view_trading group by user_id
  ), filtered as (
    select p.id customer_id,p.email,p.display_name,upper(coalesce(p.plan,'FREE')) plan,
      upper(coalesce(p.subscription_status,'INACTIVE')) subscription_status,p.created_at,
      case when can_view_trading then coalesce(s.strategy_count,0) else null end strategy_count,
      case when can_view_trading then s.active_strategy else null end active_strategy,
      case when can_view_trading then coalesce(a.account_count,0) else null end account_count,
      case when can_view_trading then coalesce(u.analysis_count,0) else null end analysis_count,
      u.last_activity_at,
      case when can_view_trading then coalesce(t.open_trades,0) else null end open_trades,
      case when can_view_trading then coalesce(t.closed_trades,0) else null end closed_trades
    from public.profiles p
    left join strategy_agg s on s.user_id=p.id
    left join account_agg a on a.user_id=p.id
    left join usage_agg u on u.user_id=p.id
    left join trade_agg t on t.user_id=p.id
    where not exists(select 1 from public.staff_roles sr where sr.user_id=p.id)
      and (nullif(trim(p_query),'') is null or concat_ws(' ',p.display_name,p.email,p.plan,p.subscription_status,
        case when can_view_trading then s.active_strategy end,
        case when can_view_trading then a.account_search end) ilike '%'||trim(p_query)||'%')
  ), counted as (select *,count(*) over() total_count from filtered), paged as (
    select * from counted order by
      case when p_sort='name' and lower(p_direction)='asc' then lower(coalesce(display_name,email,'')) end asc,
      case when p_sort='name' and lower(p_direction)='desc' then lower(coalesce(display_name,email,'')) end desc,
      case when p_sort='plan' and lower(p_direction)='asc' then plan end asc,
      case when p_sort='plan' and lower(p_direction)='desc' then plan end desc,
      case when p_sort='last_activity' and lower(p_direction)='asc' then coalesce(last_activity_at,created_at) end asc,
      case when p_sort='last_activity' and lower(p_direction)='desc' then coalesce(last_activity_at,created_at) end desc,
      case when p_sort='account_count' and lower(p_direction)='asc' then account_count end asc,
      case when p_sort='account_count' and lower(p_direction)='desc' then account_count end desc,
      case when p_sort='analysis_count' and lower(p_direction)='asc' then analysis_count end asc,
      case when p_sort='analysis_count' and lower(p_direction)='desc' then analysis_count end desc,
      case when p_sort='status' and lower(p_direction)='asc' then subscription_status end asc,
      case when p_sort='status' and lower(p_direction)='desc' then subscription_status end desc,
      customer_id
    limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(x)-'total_count') from paged x),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'tradingDataAvailable',can_view_trading,
    'summary',jsonb_build_object(
      'total',(select count(*) from filtered),
      'active',(select count(*) from filtered where subscription_status='ACTIVE'),
      'inactive',(select count(*) from filtered where subscription_status='INACTIVE'),
      'privateBeta',(select count(*) from filtered where plan='PRIVATE_BETA'),
      'free',(select count(*) from filtered where plan='FREE')
    )
  ) into result;
  return result;
end;$$;

revoke all on function public.staff_customer_directory_v2(text,integer,integer,text,text) from public,anon;
grant execute on function public.staff_customer_directory_v2(text,integer,integer,text,text) to authenticated;

create or replace function public.staff_customer_360(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; can_view_trading boolean; can_view_sales boolean; can_view_support boolean; can_view_notes boolean; can_view_compliance boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('customers.view_metadata') then raise exception 'Customer metadata permission denied'; end if;
  if exists(select 1 from public.staff_roles where user_id=p_customer_id) then return null; end if;
  can_view_trading:=public.has_staff_permission('customers.view_trading');
  can_view_sales:=public.has_staff_permission('sales.view');
  can_view_support:=public.has_staff_permission('support.view');
  can_view_notes:=can_view_sales or can_view_support;
  can_view_compliance:=public.has_staff_permission('compliance.view');

  select jsonb_build_object(
    'customer_id',p.id,'email',p.email,'display_name',p.display_name,'phone',p.phone,'discord_handle',p.discord_handle,
    'plan',p.plan,'subscription_status',p.subscription_status,'trial_started_at',p.trial_started_at,'trial_ends_at',p.trial_ends_at,
    'renewal_at',p.renewal_at,'created_at',p.created_at,
    'strategy_count',case when can_view_trading then (select count(*) from public.strategy_profiles sp where sp.user_id=p.id and not coalesce(sp.is_archived,false)) else null end,
    'account_count',case when can_view_trading then (select count(*) from public.trading_accounts ta where ta.user_id=p.id and not coalesce(ta.is_archived,false)) else null end,
    'analysis_count',case when can_view_trading then (select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) else null end,
    'last_activity_at',(select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id),
    'notes',case when can_view_notes then coalesce((select jsonb_agg(jsonb_build_object(
      'id',cn.id,'note',cn.note,'staff_user_id',cn.staff_user_id,'created_at',cn.created_at
    ) order by cn.created_at desc) from public.customer_notes cn where cn.customer_user_id=p.id),'[]'::jsonb) else null end,
    'flags',case when can_view_compliance then coalesce((select jsonb_agg(jsonb_build_object(
      'id',cc.id,'title',cc.title,'type',cc.case_type,'severity',cc.severity,'status',cc.status,'created_at',cc.created_at
    ) order by cc.created_at desc) from public.compliance_cases cc where cc.customer_user_id=p.id),'[]'::jsonb) else null end,
    'timeline',coalesce((
      select jsonb_agg(x order by (x->>'created_at')::timestamptz desc) from (
        select jsonb_build_object('type','NOTE','title','Internal note','detail',cn.note,'created_at',cn.created_at) x
          from public.customer_notes cn where cn.customer_user_id=p.id and can_view_notes
        union all
        select jsonb_build_object('type','FOLLOW_UP','title','Follow-up · '||cf.channel,'detail',coalesce(cf.summary,cf.status),'created_at',cf.created_at) x
          from public.customer_follow_ups cf where cf.customer_user_id=p.id and can_view_sales
        union all
        select jsonb_build_object('type','TICKET','title','Support ticket · '||st.subject,'detail',st.status||' · '||st.priority,'created_at',st.created_at) x
          from public.support_tickets st where st.customer_user_id=p.id and can_view_support
        union all
        select jsonb_build_object('type','COMPLIANCE','title',cc.title,'detail',cc.severity||' · '||cc.status,'created_at',cc.created_at) x
          from public.compliance_cases cc where cc.customer_user_id=p.id and can_view_compliance
      ) timeline_rows
    ),'[]'::jsonb)
  ) into result from public.profiles p where p.id=p_customer_id;
  return result;
end;$$;

revoke all on function public.staff_customer_360(uuid) from public,anon;
grant execute on function public.staff_customer_360(uuid) to authenticated;

create or replace function public.staff_customer_note_create(p_customer_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare created public.customer_notes%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('customers.view_metadata') or not (
    public.has_staff_permission('support.manage') or public.has_staff_permission('sales.manage')
  ) then raise exception 'Customer note permission denied'; end if;
  if coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then raise exception 'Multi-factor authentication required'; end if;
  if nullif(trim(p_note),'') is null or length(trim(p_note))>2000 then raise exception 'Customer note must contain 1 to 2000 characters'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_customer_id)
    or exists(select 1 from public.staff_roles sr where sr.user_id=p_customer_id) then
    raise exception 'Customer not found';
  end if;
  insert into public.customer_notes(customer_user_id,staff_user_id,note)
  values(p_customer_id,auth.uid(),trim(p_note)) returning * into created;
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success)
  values(auth.uid(),p_customer_id,'CREATE_CUSTOMER_NOTE','CUSTOMER_NOTE',created.id::text,'ACCOUNT_METADATA',true);
  return jsonb_build_object('id',created.id,'note',created.note,'staff_user_id',created.staff_user_id,'created_at',created.created_at);
end;$$;

revoke all on function public.staff_customer_note_create(uuid,text) from public,anon;
grant execute on function public.staff_customer_note_create(uuid,text) to authenticated;

create or replace function public.staff_feedback_queue()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('feedback.view') then raise exception 'Feedback view permission denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'customer_user_id',f.user_id,'customer_name',coalesce(p.display_name,'Beta tester'),
    'customer_email',coalesce(p.email,''),'title',coalesce(nullif(f.title,''),case f.feedback_type when 'ISSUE' then 'Reported issue' when 'FEATURE' then 'Feature request' else 'Beta feedback' end),
    'type',f.feedback_type,'message',f.message,'page_path',f.page_path,'browser',f.browser,'ease_score',f.ease_score,
    'priority',f.priority,'status',f.status,'assigned_staff_user_id',f.assigned_staff_user_id,
    'resolution_note',f.resolution_note,'created_at',f.created_at,'updated_at',f.updated_at
  ) order by case f.priority when 'URGENT' then 1 when 'HIGH' then 2 when 'NORMAL' then 3 else 4 end,f.created_at desc),'[]'::jsonb)
  into result from public.beta_feedback f left join public.profiles p on p.id=f.user_id where f.status<>'CLOSED';
  return result;
end;$$;

create or replace function public.update_feedback_ticket(
  p_ticket_id uuid,p_status text default null,p_priority text default null,
  p_resolution_note text default null,p_assign_to_me boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.beta_feedback%rowtype; next_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('support.manage') then raise exception 'Support management permission denied'; end if;
  if p_status is not null and p_status not in ('OPEN','REVIEWING','RESOLVED','CLOSED') then raise exception 'Invalid status'; end if;
  if p_priority is not null and p_priority not in ('LOW','NORMAL','HIGH','URGENT') then raise exception 'Invalid priority'; end if;
  select coalesce(p_status,status) into next_status from public.beta_feedback where id=p_ticket_id for update;
  if next_status is null then raise exception 'Feedback ticket not found'; end if;
  if next_status in ('RESOLVED','CLOSED') and nullif(trim(coalesce(p_resolution_note,(select resolution_note from public.beta_feedback where id=p_ticket_id))), '') is null then
    raise exception 'A resolution note is required';
  end if;
  update public.beta_feedback set status=coalesce(p_status,status),priority=coalesce(p_priority,priority),
    resolution_note=coalesce(nullif(trim(p_resolution_note),''),resolution_note),
    assigned_staff_user_id=case when p_assign_to_me then auth.uid() else assigned_staff_user_id end,
    resolved_at=case when coalesce(p_status,status) in ('RESOLVED','CLOSED') then coalesce(resolved_at,now()) else null end,
    updated_at=now() where id=p_ticket_id returning * into row_data;
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
  values(auth.uid(),row_data.user_id,'UPDATE_FEEDBACK_TICKET','BETA_FEEDBACK',row_data.id::text,true,
    jsonb_build_object('status',row_data.status,'priority',row_data.priority));
  return jsonb_build_object('id',row_data.id,'status',row_data.status,'priority',row_data.priority,'resolution_note',row_data.resolution_note);
end;$$;

revoke all on function public.staff_feedback_queue(),public.update_feedback_ticket(uuid,text,text,text,boolean) from public,anon;
grant execute on function public.staff_feedback_queue(),public.update_feedback_ticket(uuid,text,text,text,boolean) to authenticated;

alter table public.support_tickets add column if not exists resolution_note text;

create or replace function public.staff_support_queue()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('support.view') then raise exception 'Support view permission denied'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',st.id,'customer_user_id',st.customer_user_id,'customer_name',coalesce(p.display_name,'Customer'),
    'customer_email',coalesce(p.email,''),'subject',st.subject,'description',st.description,
    'status',st.status,'priority',st.priority,'assigned_staff_user_id',st.assigned_staff_user_id,
    'resolution_note',st.resolution_note,'created_at',st.created_at,'updated_at',st.updated_at
  ) order by case st.priority when 'URGENT' then 1 when 'HIGH' then 2 when 'NORMAL' then 3 else 4 end,st.created_at),'[]'::jsonb)
  into result from public.support_tickets st left join public.profiles p on p.id=st.customer_user_id
  where st.status<>'CLOSED';
  return result;
end;$$;

create or replace function public.staff_support_ticket_action(
  p_ticket_id uuid,p_status text default null,p_priority text default null,
  p_resolution_note text default null,p_assign_to_me boolean default false
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row_data public.support_tickets%rowtype; next_status text; existing_note text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('support.manage') then raise exception 'Support management permission denied'; end if;
  if p_status is not null and p_status not in ('OPEN','WAITING_CUSTOMER','RESOLVED','CLOSED') then raise exception 'Invalid status'; end if;
  if p_priority is not null and p_priority not in ('LOW','NORMAL','HIGH','URGENT') then raise exception 'Invalid priority'; end if;
  select coalesce(p_status,status),resolution_note into next_status,existing_note
    from public.support_tickets where id=p_ticket_id for update;
  if next_status is null then raise exception 'Support ticket not found'; end if;
  if next_status in ('RESOLVED','CLOSED') and nullif(trim(coalesce(p_resolution_note,existing_note)), '') is null then
    raise exception 'A resolution note is required';
  end if;
  update public.support_tickets set status=coalesce(p_status,status),priority=coalesce(p_priority,priority),
    resolution_note=coalesce(nullif(trim(p_resolution_note),''),resolution_note),
    assigned_staff_user_id=case when p_assign_to_me then auth.uid() else assigned_staff_user_id end,
    closed_at=case when coalesce(p_status,status) in ('RESOLVED','CLOSED') then coalesce(closed_at,now()) else null end,
    updated_at=now() where id=p_ticket_id returning * into row_data;
  insert into public.admin_access_logs(staff_user_id,customer_user_id,ticket_id,action,resource_type,resource_id,access_scope,success,metadata)
  values(auth.uid(),row_data.customer_user_id,row_data.id,'UPDATE_SUPPORT_TICKET','SUPPORT_TICKET',row_data.id::text,
    'ACCOUNT_METADATA',true,jsonb_build_object('status',row_data.status,'priority',row_data.priority));
  return jsonb_build_object('id',row_data.id,'status',row_data.status,'priority',row_data.priority,'resolution_note',row_data.resolution_note);
end;$$;

revoke all on function public.staff_support_queue(),public.staff_support_ticket_action(uuid,text,text,text,boolean) from public,anon;
grant execute on function public.staff_support_queue(),public.staff_support_ticket_action(uuid,text,text,text,boolean) to authenticated;

notify pgrst,'reload schema';
