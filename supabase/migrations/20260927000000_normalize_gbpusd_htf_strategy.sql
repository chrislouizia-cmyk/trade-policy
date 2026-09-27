-- Normalize the one audited GBPUSD HTF strategy in place.
-- Existing decision, trade, history, and backtest snapshots are intentionally untouched.
do $$
declare
  v_strategy_id uuid;
  v_user_id uuid;
  v_matches integer;
  v_metadata jsonb;
begin
  select count(*)
    into v_matches
  from public.strategy_profiles
  where name = 'GBPUSD HTF Liquidity & Structure v1'
    and is_archived = false;

  if v_matches = 0 then
    raise notice 'GBPUSD HTF strategy not found; normalization skipped.';
    return;
  end if;
  if v_matches <> 1 then
    raise exception 'Expected one active GBPUSD HTF strategy, found %.', v_matches;
  end if;
  select id,user_id into v_strategy_id,v_user_id
  from public.strategy_profiles
  where name='GBPUSD HTF Liquidity & Structure v1' and is_archived=false;

  update public.strategy_profiles
  set instruments = array['GBPUSD']::text[],
      market_types = array['FOREX']::text[],
      macro_timeframe = 'D1',
      trend_timeframe = 'H4',
      confirmation_timeframe = 'H1',
      entry_timeframe = 'M15',
      trigger_timeframe = 'M5',
      minimum_rr = 2,
      preferred_rr = greatest(3, coalesce(preferred_rr, 3)),
      maximum_risk_percent = 0.5,
      require_trend_alignment = false,
      required_evidence = array['liquiditySweep','chochConfirmed','bosConfirmed','retestConfirmed']::text[],
      stop_limits = jsonb_build_object('GBPUSD', 50),
      updated_at = now()
  where id = v_strategy_id and user_id = v_user_id;

  insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled)
  values(v_strategy_id,v_user_id,'GBPUSD','FOREX',null,0,true)
  on conflict(strategy_id,symbol,market_type) do update
    set market_type='FOREX',provider_symbol=null,sort_order=0,enabled=true;
  delete from public.strategy_instruments where strategy_id=v_strategy_id and symbol<>'GBPUSD';

  delete from public.strategy_rules
  where strategy_id=v_strategy_id and rule_key in ('market-structure-shift','custom-rule');

  insert into public.strategy_rules(strategy_id,user_id,rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,evaluation_mode,sort_order)
  values
    (v_strategy_id,v_user_id,'liquidity-sweep','Liquidity Sweep',true,true,10,72,'CONFIRMATION','AUTOMATIC',0),
    (v_strategy_id,v_user_id,'displacement','Displacement',true,true,10,72,'ENTRY','AUTOMATIC',1),
    (v_strategy_id,v_user_id,'choch','CHoCH',true,true,10,72,'ENTRY','AUTOMATIC',2),
    (v_strategy_id,v_user_id,'bos','BOS',true,true,10,72,'ENTRY','AUTOMATIC',3),
    (v_strategy_id,v_user_id,'retest','Retest',true,true,10,72,'ENTRY','AUTOMATIC',4),
    (v_strategy_id,v_user_id,'fair-value-gap','Fair Value Gap',true,false,10,72,'ENTRY','AUTOMATIC',5),
    (v_strategy_id,v_user_id,'order-block','Order Block',true,false,8,60,'ENTRY','MANUAL',6),
    (v_strategy_id,v_user_id,'engulfing','Engulfing',true,false,10,72,'TRIGGER','AUTOMATIC',7),
    (v_strategy_id,v_user_id,'premium-discount','Premium / Discount',true,false,4,60,'TREND','MANUAL',8),
    (v_strategy_id,v_user_id,'trend-alignment','Trend Alignment',true,false,10,72,'TREND','AUTOMATIC',9),
    (v_strategy_id,v_user_id,'session-open','Session Open',true,false,6,60,'ENTRY','EXTERNAL',10),
    (v_strategy_id,v_user_id,'pullback-entry','Pullback Entry',true,false,8,60,'TRIGGER','MANUAL',11),
    (v_strategy_id,v_user_id,'liquidity-run','Liquidity Run',true,false,8,60,'CONFIRMATION','MANUAL',12)
  on conflict(strategy_id,rule_key) do update set
    label=excluded.label,enabled=excluded.enabled,mandatory=excluded.mandatory,weight=excluded.weight,
    minimum_confidence=excluded.minimum_confidence,timeframe_role=excluded.timeframe_role,
    evaluation_mode=excluded.evaluation_mode,sort_order=excluded.sort_order;

  insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier)
  values(v_strategy_id,v_user_id,'GBPUSD','PIPS',10,30,50,null)
  on conflict(strategy_id,instrument) do update set
    method='PIPS',minimum_value=10,preferred_value=30,maximum_value=50,atr_multiplier=null;

  v_metadata := jsonb_build_object(
    'kind','TRADE_POLICE_V2_METADATA','version',1,
    'methodologyIds',jsonb_build_array('smc','ict','supply-demand','price-action','trend-following'),
    'contextTimeframe','D1','executionTimeframe','M15','direction','BOTH',
    'stopLogic',jsonb_build_object('kind','STOP_LIMITS','limits',jsonb_build_array(jsonb_build_object('instrument','GBPUSD','method','PIPS','minimumValue',10,'preferredValue',30,'maximumValue',50))),
    'ruleSelections',jsonb_build_array(
      jsonb_build_object('key','liquidity-sweep','label','Liquidity Sweep','capability','AUTOMATIC','requirement','REQUIRED','timeframe','H1','group','ALL','description','Sweep of prior highs and lows before trend continuation or reversal.'),
      jsonb_build_object('key','displacement','label','Displacement','capability','AUTOMATIC','requirement','REQUIRED','timeframe','M15','group','ALL','description','Impulse candle whose body expands beyond the configured ATR and candle-range thresholds.'),
      jsonb_build_object('key','choch','label','CHoCH','capability','AUTOMATIC','requirement','REQUIRED','timeframe','M15','group','ALL','description','Change of character after prior structure breaks.'),
      jsonb_build_object('key','bos','label','BOS','capability','AUTOMATIC','requirement','REQUIRED','timeframe','M15','group','ALL','description','Break of structure confirming directional continuation.'),
      jsonb_build_object('key','retest','label','Retest','capability','AUTOMATIC','requirement','REQUIRED','timeframe','M15','group','ALL','description','Revisit of a prior key level after a move.'),
      jsonb_build_object('key','fair-value-gap','label','Fair Value Gap','capability','AUTOMATIC','requirement','OPTIONAL','timeframe','M15','group','ANY','description','Impulse gap that later acts as a re-entry or return zone.'),
      jsonb_build_object('key','order-block','label','Order Block','capability','MANUAL','requirement','OPTIONAL','timeframe','M15','group','ANY','description','Contextual supply or demand zone requiring confirmation.'),
      jsonb_build_object('key','engulfing','label','Engulfing','capability','AUTOMATIC','requirement','OPTIONAL','timeframe','M5','group','ANY','description','Directional candle pattern.'),
      jsonb_build_object('key','premium-discount','label','Premium / Discount','capability','DESCRIPTIVE','requirement','OPTIONAL','timeframe','H4','group','ANY','description','Framework context rather than a machine-checkable trigger.'),
      jsonb_build_object('key','trend-alignment','label','Trend Alignment','capability','AUTOMATIC','requirement','OPTIONAL','timeframe','H4','group','ANY','description','Higher-timeframe direction supports the trade idea.'),
      jsonb_build_object('key','session-open','label','Session Open','capability','EXTERNAL','requirement','OPTIONAL','timeframe','M15','group','ANY','description','Session opening structure and timing context.'),
      jsonb_build_object('key','pullback-entry','label','Pullback Entry','capability','MANUAL','requirement','OPTIONAL','timeframe','M5','group','ANY','description','Requires confirmation of trend continuation.'),
      jsonb_build_object('key','liquidity-run','label','Liquidity Run','capability','MANUAL','requirement','OPTIONAL','timeframe','H1','group','ANY','description','Requires confirmation after sweeping prior liquidity.')
    ),
    'ruleTree',jsonb_build_object('type','GROUP','logic','ALL','children',jsonb_build_array(
      jsonb_build_object('type','CONDITION','ruleKey','liquidity-sweep','requirement','REQUIRED','timeframe','H1'),
      jsonb_build_object('type','CONDITION','ruleKey','displacement','requirement','REQUIRED','timeframe','M15'),
      jsonb_build_object('type','CONDITION','ruleKey','choch','requirement','REQUIRED','timeframe','M15'),
      jsonb_build_object('type','CONDITION','ruleKey','bos','requirement','REQUIRED','timeframe','M15'),
      jsonb_build_object('type','CONDITION','ruleKey','retest','requirement','REQUIRED','timeframe','M15'),
      jsonb_build_object('type','GROUP','logic','ANY','children',jsonb_build_array(
        jsonb_build_object('type','CONDITION','ruleKey','fair-value-gap','requirement','OPTIONAL','timeframe','M15'),
        jsonb_build_object('type','CONDITION','ruleKey','order-block','requirement','OPTIONAL','timeframe','M15'),
        jsonb_build_object('type','CONDITION','ruleKey','engulfing','requirement','OPTIONAL','timeframe','M5'),
        jsonb_build_object('type','CONDITION','ruleKey','premium-discount','requirement','OPTIONAL','timeframe','H4'),
        jsonb_build_object('type','CONDITION','ruleKey','trend-alignment','requirement','OPTIONAL','timeframe','H4'),
        jsonb_build_object('type','CONDITION','ruleKey','session-open','requirement','OPTIONAL','timeframe','M15'),
        jsonb_build_object('type','CONDITION','ruleKey','pullback-entry','requirement','OPTIONAL','timeframe','M5'),
        jsonb_build_object('type','CONDITION','ruleKey','liquidity-run','requirement','OPTIONAL','timeframe','H1')
      ))
    ))
  );

  update public.strategy_profiles p
  set personal_rules = coalesce((
    select jsonb_agg(item order by ordinal)
    from jsonb_array_elements(coalesce(p.personal_rules,'[]'::jsonb)) with ordinality entries(item,ordinal)
    where item->>'key' <> 'trade-police-v2-metadata'
  ),'[]'::jsonb) || jsonb_build_array(jsonb_build_object('key','trade-police-v2-metadata','enabled',true,'value',v_metadata::text))
  where p.id=v_strategy_id and p.user_id=v_user_id;
end $$;
