-- Customer 360 must not infer live positions from the immutable evidence ledger.
-- active_trades is the lifecycle authority; unlinked trade_records remain visible
-- as historical evidence without being represented as currently active.

create or replace function public.staff_customer_operational_detail(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
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
    'accounts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'broker',broker,'type',account_type,'currency',currency,
        'balance',current_balance,'active',is_active,'created_at',created_at
      ) order by created_at desc)
      from public.trading_accounts
      where user_id=p_customer_id and not is_archived
    ),'[]'::jsonb),
    'strategies',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',id,'name',name,'active',is_default,'trading_style',trading_style,
        'maximum_risk_percent',maximum_risk_percent,'minimum_rr',minimum_rr,
        'confidence_threshold',ai_behavior->>'confidenceThreshold','created_at',created_at
      ) order by is_default desc,created_at desc)
      from public.strategy_profiles
      where user_id=p_customer_id and not coalesce(is_archived,false)
    ),'[]'::jsonb),
    'analyses',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',id,'instrument',instrument,'direction',metadata->>'direction',
        'confidence',metadata->>'confidence','outcome',case when success then 'COMPLETED' else 'FAILED' end,
        'created_at',created_at
      ) order by created_at desc)
      from (
        select * from public.usage_events
        where user_id=p_customer_id and event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')
        order by created_at desc limit 10
      ) a
    ),'[]'::jsonb),
    'trades',coalesce((
      select jsonb_agg(to_jsonb(trade_rows) order by trade_rows.opened_at desc)
      from (
        select * from (
          select
            active_trade.id,
            active_trade.trade_record_id as evidence_id,
            active_trade.instrument,
            active_trade.direction,
            active_trade.entry,
            active_trade.stop_loss,
            active_trade.take_profit,
            active_trade.status,
            active_trade.opened_at,
            active_trade.closed_at,
            active_trade.outcome,
            active_trade.result_r,
            'CANONICAL'::text as record_kind,
            (active_trade.status='OPEN') as is_currently_active,
            case when active_trade.status='OPEN' then 'Active position' else 'Closed trade' end as status_label
          from public.active_trades active_trade
          where active_trade.user_id=p_customer_id

          union all

          select
            tr.id,
            tr.id as evidence_id,
            tr.instrument,
            tr.direction,
            tr.entry,
            tr.stop_loss,
            tr.take_profit,
            case
              when tr.status='CLOSED' or tr.closed_at is not null then 'CLOSED'
              else 'HISTORICAL_UNRESOLVED'
            end as status,
            tr.created_at as opened_at,
            tr.closed_at,
            tr.outcome,
            tr.result_r,
            'LEGACY_EVIDENCE'::text as record_kind,
            false as is_currently_active,
            case
              when tr.status='CLOSED' or tr.closed_at is not null then 'Historical closed trade'
              else 'Historical record'
            end as status_label
          from public.trade_records tr
          where tr.user_id=p_customer_id
            and not exists (
              select 1 from public.active_trades at_link
              where at_link.trade_record_id=tr.id
            )
        ) reconciled
        order by opened_at desc
        limit 50
      ) trade_rows
    ),'[]'::jsonb),
    'open_trades',(
      select count(*) from public.active_trades
      where user_id=p_customer_id and status='OPEN'
    ),
    'closed_trades',(
      select count(*) from public.active_trades
      where user_id=p_customer_id and status='CLOSED'
    )
  ) into result;

  insert into public.admin_access_logs(
    staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success,metadata
  ) values(
    auth.uid(),p_customer_id,'VIEW_CUSTOMER_TRADING_DETAIL','CUSTOMER',p_customer_id::text,
    'TRADE_DIAGNOSTICS',true,jsonb_build_object('mfa_level','aal2','trade_state_authority','active_trades')
  );
  return result;
end;
$$;

revoke all on function public.staff_customer_operational_detail(uuid) from public, anon;
grant execute on function public.staff_customer_operational_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
