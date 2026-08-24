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

create or replace function public.create_internal_marketplace_release_v1(
  p_strategy_profile_id uuid,
  p_source_strategy_revision_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_profile public.strategy_profiles%rowtype;
  v_canonical_strategy jsonb;
  v_expected_source_revision_id text;
  v_release_version integer;
  v_release_id uuid;
  v_listing_id uuid;
  v_sanitized_metadata jsonb;
  v_snapshot jsonb;
begin
  if not public.is_owner() then
    raise exception 'Founder permission required for internal marketplace release creation';
  end if;

  if p_strategy_profile_id is null or p_source_strategy_revision_id is null or btrim(p_source_strategy_revision_id) = '' then
    raise exception 'Strategy profile and revision are required';
  end if;

  select *
    into v_source_profile
    from public.strategy_profiles sp
    where sp.id = p_strategy_profile_id
    for update;

  if not found then
    raise exception 'Strategy profile not found or not Trade Police-owned.';
  end if;

  if v_source_profile.is_archived then
    raise exception 'Archived strategy profiles cannot be used for internal testing.';
  end if;

  if not exists (
    select 1
    from public.staff_roles sr
    where sr.user_id = v_source_profile.user_id
      and sr.is_active = true
  ) then
    raise exception 'Strategy profile not found or not owned by an active Trade Police staff user.';
  end if;

  perform 1
    from public.strategy_instruments si
    where si.strategy_id = v_source_profile.id
      and si.user_id = v_source_profile.user_id
    for update;

  perform 1
    from public.strategy_sessions ss
    where ss.strategy_id = v_source_profile.id
      and ss.user_id = v_source_profile.user_id
    for update;

  perform 1
    from public.strategy_rules sr
    where sr.strategy_id = v_source_profile.id
      and sr.user_id = v_source_profile.user_id
    for update;

  perform 1
    from public.strategy_stop_limits sl
    where sl.strategy_id = v_source_profile.id
      and sl.user_id = v_source_profile.user_id
    for update;

  if exists (
    select 1
    from public.marketplace_strategy_releases r
    where r.source_strategy_id = v_source_profile.id
      and r.source_strategy_revision_id = p_source_strategy_revision_id
  ) then
    raise exception 'An internal test release already exists for this strategy revision.';
  end if;

  v_canonical_strategy := jsonb_build_object(
    'strategy', public.marketplace_normalize_strategy_profile_for_revision(v_source_profile.id)
  );

  v_expected_source_revision_id := format(
    '%s:%s',
    coalesce(v_source_profile.engine_version, 1),
    encode(extensions.digest(public.marketplace_canonicalize_jsonb(v_canonical_strategy)::text, 'sha256'), 'hex')
  );

  if v_expected_source_revision_id <> p_source_strategy_revision_id then
    raise exception 'Strategy revision changed while preparing the internal test release. Reload the strategy before creating the release.';
  end if;

  select coalesce(max(release_version), 0) + 1
    into v_release_version
    from public.marketplace_strategy_releases
    where source_strategy_id = v_source_profile.id;

  v_sanitized_metadata := jsonb_build_object(
    'strategyName', coalesce(nullif(v_source_profile.name, ''), 'Internal test strategy'),
    'creatorName', 'Trade Police',
    'category', coalesce((v_source_profile.market_types[1]), 'INTERNAL_TEST'),
    'instruments', to_jsonb(coalesce(v_source_profile.instruments, array[]::text[])),
    'macroTimeframe', v_source_profile.macro_timeframe,
    'executionTimeframe', v_source_profile.entry_timeframe,
    'compatibility', 'COMPATIBLE',
    'ruleCounts', jsonb_build_object(
      'total', 0,
      'required', 0,
      'optional', 0,
      'automatic', 0,
      'manual', 0,
      'external', 0
    ),
    'sourceType', 'INTERNAL_TRADE_POLICE',
    'eligibilityStatus', 'ELIGIBILITY_WAIVED',
    'internalTest', true,
    'commerceEnabled', false
  );

  v_snapshot := jsonb_build_object(
    'source', jsonb_build_object(
      'kind', 'INTERNAL_TRADE_POLICE',
      'strategyProfileId', v_source_profile.id,
      'strategyRevisionId', p_source_strategy_revision_id,
      'createdBy', auth.uid()
    ),
    'profile', jsonb_build_object(
      'id', v_source_profile.id,
      'name', v_source_profile.name,
      'marketTypes', to_jsonb(coalesce(v_source_profile.market_types, array[]::text[])),
      'instruments', to_jsonb(coalesce(v_source_profile.instruments, array[]::text[])),
      'macroTimeframe', v_source_profile.macro_timeframe,
      'trendTimeframe', v_source_profile.trend_timeframe,
      'confirmationTimeframe', v_source_profile.confirmation_timeframe,
      'entryTimeframe', v_source_profile.entry_timeframe,
      'triggerTimeframe', v_source_profile.trigger_timeframe,
      'minimumRR', v_source_profile.minimum_rr,
      'maximumRiskPercent', v_source_profile.maximum_risk_percent,
      'allowedSessions', to_jsonb(coalesce(v_source_profile.allowed_sessions, array[]::text[])),
      'requiredEvidence', to_jsonb(coalesce(v_source_profile.required_evidence, array[]::text[])),
      'createdAt', v_source_profile.created_at,
      'updatedAt', v_source_profile.updated_at
    ),
    'protectedSnapshot', jsonb_build_object(
      'id', v_source_profile.id,
      'name', v_source_profile.name,
      'marketTypes', to_jsonb(coalesce(v_source_profile.market_types, array[]::text[])),
      'instruments', to_jsonb(coalesce(v_source_profile.instruments, array[]::text[])),
      'macroTimeframe', v_source_profile.macro_timeframe,
      'trendTimeframe', v_source_profile.trend_timeframe,
      'confirmationTimeframe', v_source_profile.confirmation_timeframe,
      'entryTimeframe', v_source_profile.entry_timeframe,
      'triggerTimeframe', v_source_profile.trigger_timeframe,
      'minimumRR', v_source_profile.minimum_rr,
      'maximumRiskPercent', v_source_profile.maximum_risk_percent,
      'allowedSessions', to_jsonb(coalesce(v_source_profile.allowed_sessions, array[]::text[])),
      'requiredEvidence', to_jsonb(coalesce(v_source_profile.required_evidence, array[]::text[])),
      'stopLimits', coalesce(v_source_profile.stop_limits, '{}'::jsonb),
      'evidenceWeights', coalesce(v_source_profile.evidence_weights, '{}'::jsonb),
      'createdAt', v_source_profile.created_at,
      'updatedAt', v_source_profile.updated_at
    ),
    'sanitizedMetadata', v_sanitized_metadata
  );

  insert into public.marketplace_strategy_releases(
    creator_user_id,
    source_strategy_id,
    source_strategy_revision_id,
    release_version,
    snapshot_fingerprint,
    snapshot_json,
    source_type,
    minimum_observation_days,
    eligibility_status,
    eligibility_waiver_reason,
    eligibility_waived_by,
    eligibility_waived_at,
    ip_owner_user_id,
    observation_started_at
  )
  values (
    v_source_profile.user_id,
    v_source_profile.id,
    p_source_strategy_revision_id,
    v_release_version,
    encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex'),
    v_snapshot,
    'INTERNAL_TRADE_POLICE',
    180,
    'ELIGIBILITY_WAIVED',
    'INTERNAL_TESTING',
    auth.uid(),
    now(),
    v_source_profile.user_id,
    now()
  )
  returning id into v_release_id;

  insert into public.marketplace_listings(
    release_id,
    visibility,
    review_status,
    sanitized_metadata,
    display_price_cents,
    creator_share_cents,
    platform_share_cents,
    commerce_enabled
  )
  values (
    v_release_id,
    'INTERNAL',
    'APPROVED',
    v_sanitized_metadata,
    3000,
    1500,
    1500,
    false
  )
  returning id into v_listing_id;

  insert into public.marketplace_review_events(
    release_id,
    actor_user_id,
    actor_scope,
    event_type,
    note
  )
  values (
    v_release_id,
    auth.uid(),
    'FOUNDER',
    'INTERNAL_TEST_CREATED',
    'Founder-created internal test release for an existing Trade Police strategy profile.'
  );

  return jsonb_build_object(
    'release_id', v_release_id,
    'source_strategy_id', v_source_profile.id,
    'source_strategy_revision_id', p_source_strategy_revision_id,
    'release_version', v_release_version,
    'listing_id', v_listing_id,
    'review_status', 'APPROVED',
    'sanitized_metadata', v_sanitized_metadata
  );
end;
$$;

revoke all on function public.create_internal_marketplace_release_v1(uuid, text) from public, anon;
grant execute on function public.create_internal_marketplace_release_v1(uuid, text) to authenticated;
