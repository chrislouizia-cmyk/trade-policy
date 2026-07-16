-- Trade Police V21 — scalable permission-scoped HQ customer directory.

create index if not exists profiles_last_activity_search_idx on public.profiles(created_at desc, id);
create index if not exists usage_events_user_created_idx on public.usage_events(user_id, created_at desc);
create index if not exists active_trades_user_status_count_idx on public.active_trades(user_id, status);

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
declare result jsonb;
begin
  if not public.has_staff_permission('customers.view_metadata') then
    raise exception 'Customer metadata permission denied';
  end if;
  if p_sort not in ('name','plan','last_activity','account_count','analysis_count','status') then p_sort:='last_activity'; end if;
  if lower(p_direction) not in ('asc','desc') then p_direction:='desc'; end if;
  p_page:=greatest(1,p_page); p_page_size:=greatest(1,least(p_page_size,1000));

  with strategy_agg as (
    select user_id,count(*) filter(where not coalesce(is_archived,false)) strategy_count,
      max(name) filter(where is_default and not coalesce(is_archived,false)) active_strategy
    from public.strategy_profiles group by user_id
  ), account_agg as (
    select user_id,count(*) filter(where not coalesce(is_archived,false)) account_count,
      string_agg(coalesce(name,'')||' '||coalesce(broker,''),' ') account_search
    from public.trading_accounts group by user_id
  ), usage_agg as (
    select user_id,count(*) filter(where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) analysis_count,max(created_at) last_activity_at
    from public.usage_events group by user_id
  ), trade_agg as (
    select user_id,count(*) filter(where status='OPEN') open_trades,count(*) filter(where status='CLOSED') closed_trades
    from public.active_trades group by user_id
  ), filtered as (
    select p.id customer_id,p.email,p.display_name,upper(coalesce(p.plan,'FREE')) plan,
      upper(coalesce(p.subscription_status,'INACTIVE')) subscription_status,p.created_at,
      coalesce(s.strategy_count,0) strategy_count,s.active_strategy,coalesce(a.account_count,0) account_count,
      coalesce(u.analysis_count,0) analysis_count,u.last_activity_at,coalesce(t.open_trades,0) open_trades,coalesce(t.closed_trades,0) closed_trades
    from public.profiles p
    left join strategy_agg s on s.user_id=p.id left join account_agg a on a.user_id=p.id
    left join usage_agg u on u.user_id=p.id left join trade_agg t on t.user_id=p.id
    where nullif(trim(p_query),'') is null or concat_ws(' ',p.display_name,p.email,p.plan,p.subscription_status,s.active_strategy,a.account_search) ilike '%'||trim(p_query)||'%'
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

revoke all on function public.staff_customer_directory_v2(text,integer,integer,text,text) from public;
grant execute on function public.staff_customer_directory_v2(text,integer,integer,text,text) to authenticated;

create or replace function public.staff_customer_operational_detail(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('customers.view_metadata') then raise exception 'Customer metadata permission denied'; end if;
  if not exists(select 1 from public.profiles where id=p_customer_id) then return null; end if;
  select jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'broker',broker,'type',account_type,'currency',currency,'balance',current_balance,'active',is_active,'created_at',created_at) order by created_at desc) from public.trading_accounts where user_id=p_customer_id and not is_archived),'[]'::jsonb),
    'strategies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',is_default,'trading_style',trading_style,'maximum_risk_percent',maximum_risk_percent,'minimum_rr',minimum_rr,'confidence_threshold',ai_behavior->>'confidenceThreshold','created_at',created_at) order by is_default desc,created_at desc) from public.strategy_profiles where user_id=p_customer_id and not coalesce(is_archived,false)),'[]'::jsonb),
    'analyses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'instrument',instrument,'direction',metadata->>'direction','confidence',metadata->>'confidence','outcome',case when success then 'COMPLETED' else 'FAILED' end,'created_at',created_at) order by created_at desc) from (select * from public.usage_events where user_id=p_customer_id and event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') order by created_at desc limit 10) a),'[]'::jsonb),
    'trades',coalesce((select jsonb_agg(jsonb_build_object('id',id,'instrument',instrument,'direction',direction,'entry',entry,'stop_loss',stop_loss,'take_profit',take_profit,'status',status,'opened_at',created_at,'closed_at',closed_at,'outcome',outcome,'result_r',result_r) order by created_at desc) from (select * from public.trade_records where user_id=p_customer_id order by created_at desc limit 20) t),'[]'::jsonb),
    'feedback',case when public.has_staff_permission('feedback.view') then coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',feedback_type,'message',message,'status',status,'created_at',created_at) order by created_at desc) from public.beta_feedback where user_id=p_customer_id),'[]'::jsonb) else null end,
    'open_trades',(select count(*) from public.active_trades where user_id=p_customer_id and status='OPEN'),
    'closed_trades',(select count(*) from public.active_trades where user_id=p_customer_id and status='CLOSED'),
    'feedback_count',(select count(*) from public.beta_feedback where user_id=p_customer_id)
  ) into result;
  return result;
end;$$;
revoke all on function public.staff_customer_operational_detail(uuid) from public;
grant execute on function public.staff_customer_operational_detail(uuid) to authenticated;
