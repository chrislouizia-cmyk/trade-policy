-- Keep strategy deletion as SECURITY INVOKER. Marketplace release tables are
-- intentionally not readable by authenticated users, so the delete RPC must
-- not probe those tables directly. Their RESTRICT foreign keys remain the
-- authority that protects immutable Marketplace evidence.

create or replace function public.delete_strategy_playbook(p_strategy_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_strategy public.strategy_profiles%rowtype;
  v_fallback_strategy_id uuid := null;
  v_trade_records integer := 0;
  v_active_trades integer := 0;
  v_market_scans integer := 0;
  v_decision_reports integer := 0;
  v_backtest_runs integer := 0;
  v_constraint_name text := null;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_strategy
  from public.strategy_profiles
  where id = p_strategy_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Playbook not found';
  end if;

  if v_strategy.is_default then
    select id
    into v_fallback_strategy_id
    from public.strategy_profiles
    where user_id = v_user_id
      and id <> p_strategy_id
      and is_archived = false
    order by created_at asc
    limit 1
    for update;
  end if;

  update public.trade_records
  set strategy_profile_id = null
  where user_id = v_user_id
    and strategy_profile_id = p_strategy_id;
  get diagnostics v_trade_records = row_count;

  update public.active_trades
  set strategy_profile_id = null
  where user_id = v_user_id
    and strategy_profile_id = p_strategy_id;
  get diagnostics v_active_trades = row_count;

  update public.market_scans
  set strategy_profile_id = null
  where user_id = v_user_id
    and strategy_profile_id = p_strategy_id;
  get diagnostics v_market_scans = row_count;

  select count(*)::integer
  into v_decision_reports
  from public.decision_reports
  where user_id = v_user_id
    and strategy_id = p_strategy_id;

  update public.backtest_runs
  set strategy_profile_id = null
  where user_id = v_user_id
    and strategy_profile_id = p_strategy_id;
  get diagnostics v_backtest_runs = row_count;

  begin
    delete from public.strategy_profiles
    where id = p_strategy_id
      and user_id = v_user_id;

    if not found then
      raise exception 'Playbook could not be deleted';
    end if;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name like 'marketplace_%' then
        raise exception
          'This strategy has a Marketplace release. Remove or archive its Marketplace presence before deleting the source strategy.';
      end if;

      raise;
  end;

  if v_strategy.is_default and v_fallback_strategy_id is not null then
    update public.strategy_profiles
    set is_default = true,
        updated_at = now()
    where id = v_fallback_strategy_id
      and user_id = v_user_id
      and is_archived = false;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'strategyId', p_strategy_id,
    'fallbackStrategyId', v_fallback_strategy_id,
    'detachedTradeRecords', v_trade_records,
    'detachedActiveTrades', v_active_trades,
    'detachedMarketScans', v_market_scans,
    'detachedDecisionReports', v_decision_reports,
    'detachedBacktestRuns', v_backtest_runs
  );
end;
$$;

revoke all on function public.delete_strategy_playbook(uuid)
from public, anon;

grant execute on function public.delete_strategy_playbook(uuid)
to authenticated;

notify pgrst, 'reload schema';
