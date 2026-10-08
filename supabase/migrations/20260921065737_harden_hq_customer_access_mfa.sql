-- Close the Customer 360 permission regression and make the existing HQ MFA
-- requirement enforceable by the application and sensitive database RPCs.

insert into public.staff_permissions(permission_key,description,sensitive)
values(
  'customers.view_trading',
  'View customer trading accounts, balances, strategy configuration, analyses, and trades.',
  true
)
on conflict(permission_key) do update set
  description=excluded.description,
  sensitive=excluded.sensitive;

-- Keep this permission out of every seeded non-owner profile. An Owner can
-- explicitly add it to a custom profile through the existing permission UI.
insert into public.role_permissions(role,permission_key)
values('OWNER','customers.view_trading')
on conflict do nothing;

insert into public.permission_profile_permissions(profile_id,permission_key)
select id,'customers.view_trading'
from public.permission_profiles
where role_key='OWNER'
on conflict do nothing;

create or replace function public.current_staff_mfa_requirement()
returns boolean language plpgsql stable security definer set search_path=public as $$
declare required boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select sr.mfa_required into required
  from public.staff_roles sr
  where sr.user_id=auth.uid() and sr.is_active
  limit 1;
  if required is null then raise exception 'Active staff role not found'; end if;
  return required;
end;$$;

revoke all on function public.current_staff_mfa_requirement() from public,anon;
grant execute on function public.current_staff_mfa_requirement() to authenticated;

-- Permission profiles are the current authority. The onboarding migration had
-- accidentally restored legacy role_permissions lookup, making custom profile
-- grants ineffective. MFA-required staff receive no permission at AAL1.
create or replace function public.has_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(
    (
      select spo.granted
      from public.staff_permission_overrides spo
      join public.staff_roles sr on sr.user_id=spo.user_id
      where spo.user_id=auth.uid()
        and spo.permission_key=p_permission
        and sr.is_active
        and (not sr.mfa_required or coalesce(auth.jwt()->>'aal','aal1')='aal2')
        and not exists(
          select 1 from public.staff_invitations si
          where si.user_id=sr.user_id and si.status<>'ACCEPTED'
        )
      limit 1
    ),
    exists(
      select 1
      from public.staff_roles sr
      join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active
      join public.permission_profile_permissions ppp on ppp.profile_id=pp.id
      where sr.user_id=auth.uid()
        and sr.is_active
        and ppp.permission_key=p_permission
        and (not sr.mfa_required or coalesce(auth.jwt()->>'aal','aal1')='aal2')
        and not exists(
          select 1 from public.staff_invitations si
          where si.user_id=sr.user_id and si.status<>'ACCEPTED'
        )
    ),
    false
  )
$$;

revoke all on function public.has_staff_permission(text) from public,anon;
grant execute on function public.has_staff_permission(text) to authenticated;

create or replace function public.staff_customer_360(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; can_view_trading boolean; can_view_sales boolean; can_view_support boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('customers.view_metadata') then raise exception 'Customer metadata permission denied'; end if;
  if exists(select 1 from public.staff_roles where user_id=p_customer_id and is_active) then return null; end if;
  can_view_trading:=public.has_staff_permission('customers.view_trading');
  can_view_sales:=public.has_staff_permission('sales.view');
  can_view_support:=public.has_staff_permission('support.view');

  select jsonb_build_object(
    'customer_id',p.id,'email',p.email,'display_name',p.display_name,'phone',p.phone,'discord_handle',p.discord_handle,
    'plan',p.plan,'subscription_status',p.subscription_status,'trial_started_at',p.trial_started_at,'trial_ends_at',p.trial_ends_at,
    'renewal_at',p.renewal_at,'created_at',p.created_at,
    'strategy_count',case when can_view_trading then (select count(*) from public.strategy_profiles sp where sp.user_id=p.id and coalesce(sp.is_archived,false)=false) else null end,
    'account_count',case when can_view_trading then (select count(*) from public.trading_accounts ta where ta.user_id=p.id and coalesce(ta.is_archived,false)=false) else null end,
    'analysis_count',case when can_view_trading then (select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')) else null end,
    'last_activity_at',(select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id),
    'timeline',coalesce((
      select jsonb_agg(x order by (x->>'created_at')::timestamptz desc)
      from (
        select jsonb_build_object('type','NOTE','title','Internal note','detail',cn.note,'created_at',cn.created_at) x from public.customer_notes cn where cn.customer_user_id=p.id and can_view_trading
        union all
        select jsonb_build_object('type','FOLLOW_UP','title','Follow-up · '||cf.channel,'detail',coalesce(cf.summary,cf.status),'created_at',cf.created_at) x from public.customer_follow_ups cf where cf.customer_user_id=p.id and can_view_sales
        union all
        select jsonb_build_object('type','TICKET','title','Support ticket · '||st.subject,'detail',st.status||' · '||st.priority,'created_at',st.created_at) x from public.support_tickets st where st.customer_user_id=p.id and can_view_support
      ) timeline_rows
    ),'[]'::jsonb)
  ) into result from public.profiles p where p.id=p_customer_id;
  return result;
end;$$;

revoke all on function public.staff_customer_360(uuid) from public,anon;
grant execute on function public.staff_customer_360(uuid) to authenticated;

create or replace function public.staff_customer_operational_detail(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('customers.view_trading') then
    raise exception 'Customer trading permission denied';
  end if;
  if coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then
    raise exception 'Multi-factor authentication required';
  end if;
  if exists(select 1 from public.staff_roles where user_id=p_customer_id and is_active) then
    raise exception 'Staff records are not customer records';
  end if;
  if not exists(select 1 from public.profiles where id=p_customer_id) then return null; end if;

  select jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'broker',broker,'type',account_type,'currency',currency,'balance',current_balance,'active',is_active,'created_at',created_at) order by created_at desc) from public.trading_accounts where user_id=p_customer_id and not is_archived),'[]'::jsonb),
    'strategies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',is_default,'trading_style',trading_style,'maximum_risk_percent',maximum_risk_percent,'minimum_rr',minimum_rr,'confidence_threshold',ai_behavior->>'confidenceThreshold','created_at',created_at) order by is_default desc,created_at desc) from public.strategy_profiles where user_id=p_customer_id and not coalesce(is_archived,false)),'[]'::jsonb),
    'analyses',coalesce((select jsonb_agg(jsonb_build_object('id',id,'instrument',instrument,'direction',metadata->>'direction','confidence',metadata->>'confidence','outcome',case when success then 'COMPLETED' else 'FAILED' end,'created_at',created_at) order by created_at desc) from (select * from public.usage_events where user_id=p_customer_id and event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') order by created_at desc limit 10) a),'[]'::jsonb),
    'trades',coalesce((select jsonb_agg(jsonb_build_object('id',id,'instrument',instrument,'direction',direction,'entry',entry,'stop_loss',stop_loss,'take_profit',take_profit,'status',status,'opened_at',created_at,'closed_at',closed_at,'outcome',outcome,'result_r',result_r) order by created_at desc) from (select * from public.trade_records where user_id=p_customer_id order by created_at desc limit 20) t),'[]'::jsonb),
    'open_trades',(select count(*) from public.active_trades where user_id=p_customer_id and status='OPEN'),
    'closed_trades',(select count(*) from public.active_trades where user_id=p_customer_id and status='CLOSED')
  ) into result;

  insert into public.admin_access_logs(
    staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success,metadata
  ) values(
    auth.uid(),p_customer_id,'VIEW_CUSTOMER_TRADING_DETAIL','CUSTOMER',p_customer_id::text,
    'TRADE_DIAGNOSTICS',true,jsonb_build_object('mfa_level','aal2')
  );
  return result;
end;$$;

revoke all on function public.staff_customer_operational_detail(uuid) from public,anon;
grant execute on function public.staff_customer_operational_detail(uuid) to authenticated;

create or replace function public.staff_customer_feedback_detail(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('feedback.view') then raise exception 'Customer feedback permission denied'; end if;
  if coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then raise exception 'Multi-factor authentication required'; end if;
  if exists(select 1 from public.staff_roles where user_id=p_customer_id and is_active) then
    raise exception 'Staff records are not customer records';
  end if;
  if not exists(select 1 from public.profiles where id=p_customer_id) then return null; end if;
  select jsonb_build_object(
    'feedback',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',feedback_type,'message',message,'status',status,'created_at',created_at) order by created_at desc) from public.beta_feedback where user_id=p_customer_id),'[]'::jsonb),
    'feedback_count',(select count(*) from public.beta_feedback where user_id=p_customer_id)
  ) into result;
  insert into public.admin_access_logs(
    staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success,metadata
  ) values(
    auth.uid(),p_customer_id,'VIEW_CUSTOMER_FEEDBACK','CUSTOMER',p_customer_id::text,
    'ACCOUNT_METADATA',true,jsonb_build_object('mfa_level','aal2')
  );
  return result;
end;$$;

revoke all on function public.staff_customer_feedback_detail(uuid) from public,anon;
grant execute on function public.staff_customer_feedback_detail(uuid) to authenticated;

notify pgrst,'reload schema';
