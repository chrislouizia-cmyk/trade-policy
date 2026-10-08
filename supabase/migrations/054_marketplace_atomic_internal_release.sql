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
  v_source_strategy_revision_id text;
  v_expected_source_revision_id text;
  v_canonical_strategy jsonb;
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
    'id', v_source_profile.id,
    'engineVersion', coalesce(v_source_profile.engine_version, 1),
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
    'evidenceWeights', coalesce(v_source_profile.evidence_weights, '{}'::jsonb),
    'stopLimits', coalesce(v_source_profile.stop_limits, '{}'::jsonb),
    'strategyInstruments', coalesce((
      select jsonb_agg(to_jsonb(si) order by si.sort_order, si.id)
      from public.strategy_instruments si
      where si.strategy_id = v_source_profile.id
        and si.user_id = v_source_profile.user_id
    ), '[]'::jsonb),
    'strategySessions', coalesce((
      select jsonb_agg(to_jsonb(ss) order by ss.created_at, ss.id)
      from public.strategy_sessions ss
      where ss.strategy_id = v_source_profile.id
        and ss.user_id = v_source_profile.user_id
    ), '[]'::jsonb),
    'strategyRules', coalesce((
      select jsonb_agg(to_jsonb(sr) order by sr.sort_order, sr.id)
      from public.strategy_rules sr
      where sr.strategy_id = v_source_profile.id
        and sr.user_id = v_source_profile.user_id
    ), '[]'::jsonb),
    'strategyStopLimits', coalesce((
      select jsonb_agg(to_jsonb(sl) order by sl.instrument, sl.id)
      from public.strategy_stop_limits sl
      where sl.strategy_id = v_source_profile.id
        and sl.user_id = v_source_profile.user_id
    ), '[]'::jsonb)
  );

  v_expected_source_revision_id := format(
    '%s:%s',
    coalesce(v_source_profile.engine_version, 1),
    encode(pgcrypto.digest(v_canonical_strategy::text, 'sha256'), 'hex')
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
    encode(pgcrypto.digest(v_snapshot::text, 'sha256'), 'hex'),
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
notify pgrst, 'reload schema';
