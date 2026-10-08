-- Repair Delete Strategy semantics.
-- Archive remains reversible.
-- Delete is permanent, ownership-scoped and history-preserving.
-- Immutable Marketplace releases remain protected.

-- Backtests are historical artifacts and already carry an immutable strategy snapshot.
-- They must survive deletion of the editable source profile.
alter table public.backtest_runs
  alter column strategy_profile_id drop not null;

alter table public.backtest_runs
  drop constraint if exists backtest_runs_strategy_profile_id_fkey;

alter table public.backtest_runs
  add constraint backtest_runs_strategy_profile_id_fkey
  foreign key (strategy_profile_id)
  references public.strategy_profiles(id)
  on delete set null;

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

  -- Marketplace releases are immutable evidence.
  -- Do not sever their canonical source identity implicitly.
  if exists (
    select 1
    from public.marketplace_strategy_releases
    where source_strategy_id = p_strategy_id
  ) then
    raise exception
      'This strategy has a Marketplace release. Remove or archive its Marketplace presence before deleting the source strategy.';
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

  -- Preserve historical truth while detaching the editable strategy profile.
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

  update public.decision_reports
  set strategy_id = null
  where user_id = v_user_id
    and strategy_id = p_strategy_id;
  get diagnostics v_decision_reports = row_count;

  update public.backtest_runs
  set strategy_profile_id = null
  where user_id = v_user_id
    and strategy_profile_id = p_strategy_id;
  get diagnostics v_backtest_runs = row_count;

  delete from public.strategy_profiles
  where id = p_strategy_id
    and user_id = v_user_id;

  if not found then
    raise exception 'Playbook could not be deleted';
  end if;

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
