-- Complete playbook lifecycle management with history-preserving deletion.

create or replace function public.delete_strategy_playbook(p_strategy_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_strategy public.strategy_profiles%rowtype;
  v_trade_records integer := 0;
  v_active_trades integer := 0;
  v_market_scans integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;

  select * into v_strategy
  from public.strategy_profiles
  where id = p_strategy_id and user_id = v_user_id
  for update;

  if not found then raise exception 'Playbook not found'; end if;
  if v_strategy.is_default then raise exception 'Activate another playbook before deleting this one'; end if;

  update public.trade_records
  set strategy_profile_id = null
  where user_id = v_user_id and strategy_profile_id = p_strategy_id;
  get diagnostics v_trade_records = row_count;

  update public.active_trades
  set strategy_profile_id = null
  where user_id = v_user_id and strategy_profile_id = p_strategy_id;
  get diagnostics v_active_trades = row_count;

  update public.market_scans
  set strategy_profile_id = null
  where user_id = v_user_id and strategy_profile_id = p_strategy_id;
  get diagnostics v_market_scans = row_count;

  delete from public.strategy_profiles
  where id = p_strategy_id and user_id = v_user_id;

  return jsonb_build_object(
    'deleted', true,
    'strategyId', p_strategy_id,
    'detachedTradeRecords', v_trade_records,
    'detachedActiveTrades', v_active_trades,
    'detachedMarketScans', v_market_scans
  );
end;
$$;

revoke all on function public.delete_strategy_playbook(uuid) from public;
grant execute on function public.delete_strategy_playbook(uuid) to authenticated;

notify pgrst, 'reload schema';
