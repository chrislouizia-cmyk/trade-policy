-- Expand the audited GBPUSD definition into the intended multi-instrument Forex strategy.
-- The strategy row is updated in place so its History, trades, reports, and backtests keep their references.
do $$
declare
  v_strategy record;
  v_metadata jsonb;
begin
  for v_strategy in
    select id, user_id
    from public.strategy_profiles
    where lower(name) in (
      lower('GBPUSD HTF Liquidity & Structure v1'),
      lower('Forex HTF Liquidity & Structure v1')
    )
      and is_archived = false
  loop
    update public.strategy_profiles
    set name = 'Forex HTF Liquidity & Structure v1',
        instruments = array['GBPUSD','EURUSD','GBPJPY','USDJPY']::text[],
        market_types = array['FOREX']::text[],
        macro_timeframe = 'D1',
        trend_timeframe = 'H4',
        confirmation_timeframe = 'H1',
        entry_timeframe = 'M15',
        trigger_timeframe = 'M5',
        minimum_rr = 2,
        preferred_rr = greatest(3, coalesce(preferred_rr, 3)),
        maximum_risk_percent = 0.5,
        stop_limits = jsonb_build_object('GBPUSD',50,'EURUSD',50,'GBPJPY',60,'USDJPY',50),
        updated_at = now()
    where id=v_strategy.id and user_id=v_strategy.user_id;

    delete from public.strategy_instruments where strategy_id=v_strategy.id;
    insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled)
    values
      (v_strategy.id,v_strategy.user_id,'GBPUSD','FOREX','GBP/USD',0,true),
      (v_strategy.id,v_strategy.user_id,'EURUSD','FOREX','EUR/USD',1,true),
      (v_strategy.id,v_strategy.user_id,'GBPJPY','FOREX','GBP/JPY',2,true),
      (v_strategy.id,v_strategy.user_id,'USDJPY','FOREX','USD/JPY',3,true);

    delete from public.strategy_stop_limits where strategy_id=v_strategy.id;
    insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier)
    values
      (v_strategy.id,v_strategy.user_id,'GBPUSD','PIPS',10,30,50,null),
      (v_strategy.id,v_strategy.user_id,'EURUSD','PIPS',10,30,50,null),
      (v_strategy.id,v_strategy.user_id,'GBPJPY','PIPS',15,35,60,null),
      (v_strategy.id,v_strategy.user_id,'USDJPY','PIPS',10,30,50,null);

    select (entry->>'value')::jsonb
      into v_metadata
    from jsonb_array_elements(coalesce((select personal_rules from public.strategy_profiles where id=v_strategy.id),'[]'::jsonb)) entry
    where entry->>'key'='trade-police-v2-metadata'
    limit 1;

    if v_metadata is not null then
      v_metadata := jsonb_set(
        v_metadata,
        '{stopLogic}',
        jsonb_build_object('kind','STOP_LIMITS','limits',jsonb_build_array(
          jsonb_build_object('instrument','GBPUSD','method','PIPS','minimumValue',10,'preferredValue',30,'maximumValue',50),
          jsonb_build_object('instrument','EURUSD','method','PIPS','minimumValue',10,'preferredValue',30,'maximumValue',50),
          jsonb_build_object('instrument','GBPJPY','method','PIPS','minimumValue',15,'preferredValue',35,'maximumValue',60),
          jsonb_build_object('instrument','USDJPY','method','PIPS','minimumValue',10,'preferredValue',30,'maximumValue',50)
        )),
        true
      );

      update public.strategy_profiles p
      set personal_rules = coalesce((
        select jsonb_agg(item order by ordinal)
        from jsonb_array_elements(coalesce(p.personal_rules,'[]'::jsonb)) with ordinality entries(item,ordinal)
        where item->>'key'<>'trade-police-v2-metadata'
      ),'[]'::jsonb) || jsonb_build_array(jsonb_build_object('key','trade-police-v2-metadata','enabled',true,'value',v_metadata::text))
      where p.id=v_strategy.id and p.user_id=v_strategy.user_id;
    end if;
  end loop;
end $$;
