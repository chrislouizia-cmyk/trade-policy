-- Final strategy deletion contract.
--
-- The editable strategy may be deleted by its owner, while immutable evidence
-- (decisions, trades, backtests, shares and Marketplace releases) survives by
-- detaching its nullable foreign key. Marketplace discovery is archived before
-- the source is removed. SECURITY DEFINER is required because authenticated
-- users intentionally have no direct write access to protected Marketplace
-- release/listing tables; the function therefore uses an empty search_path and
-- re-checks ownership on every user-scoped mutation.

create or replace function public.delete_strategy_playbook(p_strategy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_strategy public.strategy_profiles%rowtype;
  v_fallback_strategy_id uuid := null;
  v_marketplace_releases integer := 0;
  v_trade_records integer := 0;
  v_active_trades integer := 0;
  v_market_scans integer := 0;
  v_decision_reports integer := 0;
  v_backtest_runs integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_strategy_id is null then
    raise exception 'Strategy id is required';
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
    order by created_at asc, id asc
    limit 1
    for update;
  end if;

  update public.marketplace_listings as listing
  set review_status = 'ARCHIVED',
      updated_at = now()
  from public.marketplace_strategy_releases as release
  where listing.release_id = release.id
    and release.source_strategy_id = p_strategy_id
    and release.creator_user_id = v_user_id
    and listing.review_status <> 'ARCHIVED';

  insert into public.marketplace_review_events (
    release_id,
    actor_user_id,
    actor_scope,
    event_type,
    note
  )
  select
    id,
    v_user_id,
    'SYSTEM',
    'SOURCE_STRATEGY_DELETED',
    'Editable source deleted by its owner; immutable release and historical evidence preserved.'
  from public.marketplace_strategy_releases
  where source_strategy_id = p_strategy_id
    and creator_user_id = v_user_id;

  select count(*)::integer
  into v_marketplace_releases
  from public.marketplace_strategy_releases
  where source_strategy_id = p_strategy_id
    and creator_user_id = v_user_id;

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
    'preservedMarketplaceReleases', v_marketplace_releases,
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

comment on function public.delete_strategy_playbook(uuid) is
  'Owner-authorized hard delete of editable strategy state; immutable historical and Marketplace evidence is detached and preserved.';

notify pgrst, 'reload schema';
