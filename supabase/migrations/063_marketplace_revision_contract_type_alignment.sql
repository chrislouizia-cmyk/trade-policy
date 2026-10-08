create or replace function public.marketplace_normalize_strategy_profile_for_revision(p_strategy_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_profile public.strategy_profiles%rowtype;
  v_instruments text[];
  v_sessions jsonb;
  v_rules jsonb;
  v_stop_limit_settings jsonb;
  v_allowed_sessions text[];
  v_normalized jsonb;
begin
  select *
    into v_source_profile
    from public.strategy_profiles sp
    where sp.id = p_strategy_profile_id;

  if not found then
    raise exception 'Strategy profile not found.';
  end if;

  select coalesce(array_agg(si.symbol order by si.sort_order, si.id), array[]::text[])
    into v_instruments
    from public.strategy_instruments si
    where si.strategy_id = v_source_profile.id
      and si.user_id = v_source_profile.user_id
      and si.enabled = true;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', ss.id,
        'sessionCode', ss.session_code,
        'name', ss.name,
        'timezone', ss.timezone,
        'startTime', ss.start_time,
        'endTime', ss.end_time,
        'days', coalesce(ss.days, array[1, 2, 3, 4, 5]::int[]),
        'allowOpenOutside', coalesce(ss.allow_open_outside, false),
        'allowHoldOutside', coalesce(ss.allow_hold_outside, false),
        'isCustom', coalesce(ss.is_custom, false)
      ) order by ss.created_at, ss.id
    ), '[]'::jsonb)
    into v_sessions
    from public.strategy_sessions ss
    where ss.strategy_id = v_source_profile.id
      and ss.user_id = v_source_profile.user_id;

  select coalesce(array_agg(s.session_code order by s.created_at, s.id), array[]::text[])
    into v_allowed_sessions
    from public.strategy_sessions s
    where s.strategy_id = v_source_profile.id
      and s.user_id = v_source_profile.user_id;

  if array_length(v_allowed_sessions, 1) is null then
    v_allowed_sessions := coalesce(v_source_profile.allowed_sessions, array[]::text[]);
  end if;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'ruleKey', sr.rule_key,
        'label', sr.label,
        'enabled', coalesce(sr.enabled, false),
        'mandatory', coalesce(sr.mandatory, false),
        'weight', coalesce(sr.weight::numeric, 0),
        'minimumConfidence', coalesce(sr.minimum_confidence::numeric, 0),
        'timeframeRole', sr.timeframe_role,
        'evaluationMode', coalesce(sr.evaluation_mode, 'AUTOMATIC')
      ) order by sr.sort_order, sr.id
    ), '[]'::jsonb)
    into v_rules
    from public.strategy_rules sr
    where sr.strategy_id = v_source_profile.id
      and sr.user_id = v_source_profile.user_id;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'instrument', sl.instrument,
        'method', sl.method,
        'minimumValue', coalesce(sl.minimum_value, 0)::numeric,
        'preferredValue', coalesce(sl.preferred_value, sl.maximum_value, 0)::numeric,
        'maximumValue', coalesce(sl.maximum_value, 0)::numeric,
        'atrMultiplier', case when sl.atr_multiplier is null then null else sl.atr_multiplier::numeric end
      ) order by sl.instrument, sl.id
    ), '[]'::jsonb)
    into v_stop_limit_settings
    from public.strategy_stop_limits sl
    where sl.strategy_id = v_source_profile.id
      and sl.user_id = v_source_profile.user_id;

  v_normalized := jsonb_strip_nulls(
    jsonb_build_object(
      'id', v_source_profile.id,
      'engineVersion', coalesce(v_source_profile.engine_version, case when v_source_profile.macro_timeframe is not null and v_source_profile.trigger_timeframe is not null then 2 else 1 end),
      'name', v_source_profile.name,
      'description', coalesce(v_source_profile.description, ''),
      'isDefault', coalesce(v_source_profile.is_default, false),
      'isArchived', coalesce(v_source_profile.is_archived, false),
      'marketTypes', coalesce(v_source_profile.market_types, array[]::text[]),
      'instruments', case when array_length(v_instruments, 1) > 0 then to_jsonb(v_instruments) else to_jsonb(coalesce(v_source_profile.instruments, array[]::text[])) end,
      'macroTimeframe', v_source_profile.macro_timeframe,
      'trendTimeframe', v_source_profile.trend_timeframe,
      'confirmationTimeframe', v_source_profile.confirmation_timeframe,
      'entryTimeframe', v_source_profile.entry_timeframe,
      'triggerTimeframe', v_source_profile.trigger_timeframe,
      'minimumRR', v_source_profile.minimum_rr,
      'preferredRR', coalesce(v_source_profile.preferred_rr, v_source_profile.minimum_rr),
      'maximumRiskPercent', v_source_profile.maximum_risk_percent,
      'maximumDailyRiskPercent', coalesce(v_source_profile.maximum_daily_risk_percent, 1.5),
      'maximumWeeklyRiskPercent', coalesce(v_source_profile.maximum_weekly_risk_percent, 4),
      'maximumDailyLossPercent', coalesce(v_source_profile.maximum_daily_loss_percent, 2),
      'maximumTotalExposurePercent', coalesce(v_source_profile.maximum_total_exposure_percent, 2),
      'maximumCurrencyExposurePercent', coalesce(v_source_profile.maximum_currency_exposure_percent, 1),
      'maximumTradesPerDay', v_source_profile.maximum_trades_per_day
    )
    || jsonb_build_object(
      'instrumentTradeLimits', coalesce(v_source_profile.instrument_trade_limits, '{}'::jsonb),
      'greenDayProtectionEnabled', coalesce(v_source_profile.green_day_protection_enabled, false),
      'greenDayProtectedFloorMode', coalesce(v_source_profile.green_day_protected_floor_mode, 'ZERO'),
      'greenDayProtectedFloorValue', coalesce(v_source_profile.green_day_protected_floor_value, 0),
      'greenDayMaxExtraTrades', coalesce(v_source_profile.green_day_max_extra_trades, 1),
      'greenDayExtraRiskMultiplier', coalesce(v_source_profile.green_day_extra_risk_multiplier, 0.5),
      'greenDayRequireAuthorized', case when v_source_profile.green_day_require_authorized is null then true else v_source_profile.green_day_require_authorized end,
      'maximumConsecutiveLosses', coalesce(v_source_profile.maximum_consecutive_losses, v_source_profile.loss_streak_limit, 5),
      'allowedSessions', to_jsonb(coalesce(v_allowed_sessions, array[]::text[])),
      'sessions', v_sessions,
      'avoidHighImpactNews', coalesce(v_source_profile.avoid_high_impact_news, false),
      'newsMode', coalesce(v_source_profile.news_mode, 'RELEVANT_CURRENCIES'),
      'newsBlockMinutesBefore', coalesce(v_source_profile.news_block_minutes_before, 30),
      'newsBlockMinutesAfter', coalesce(v_source_profile.news_block_minutes_after, 15),
      'newsCurrencies', coalesce(v_source_profile.news_currencies, array['USD', 'GBP', 'JPY']::text[]),
      'requireTrendAlignment', coalesce(v_source_profile.require_trend_alignment, false),
      'requiredEvidence', coalesce(v_source_profile.required_evidence, array[]::text[]),
      'evidenceWeights', coalesce(v_source_profile.evidence_weights, '{}'::jsonb),
      'rules', v_rules,
      'stopLimits', coalesce(v_source_profile.stop_limits, '{}'::jsonb),
      'stopLimitSettings', v_stop_limit_settings,
      'authorizationScore', coalesce(v_source_profile.authorization_score, 0),
      'waitScore', coalesce(v_source_profile.wait_score, 0),
      'lossStreakLimit', coalesce(v_source_profile.loss_streak_limit, v_source_profile.maximum_consecutive_losses, 5)
    )
    || jsonb_build_object(
      'preferredSetups', coalesce(v_source_profile.preferred_setups, array[]::text[]),
      'rejectUnlistedSetups', coalesce(v_source_profile.reject_unlisted_setups, false),
      'trailingConfig', coalesce(v_source_profile.trailing_config, '{}'::jsonb),
      'exitConfig', coalesce(v_source_profile.exit_config, '{}'::jsonb),
      'monitorConfig', coalesce(v_source_profile.monitor_config, '{}'::jsonb),
      'tradingStyle', coalesce(v_source_profile.trading_style, 'day-trading'),
      'minimumHoldingMinutes', coalesce(v_source_profile.minimum_holding_minutes, 15),
      'strategyMethodologies', coalesce(v_source_profile.strategy_methodologies, '[]'::jsonb),
      'personalRules', coalesce(v_source_profile.personal_rules, '[]'::jsonb),
      'aiBehavior', coalesce(v_source_profile.ai_behavior, '{"tone":"analytical","strictness":"conservative","confidenceThreshold":80,"explainDecisions":true,"suggestAlternatives":true,"useDisplayName":true}'::jsonb)
    )
  );

  return v_normalized;
end;
$$;
