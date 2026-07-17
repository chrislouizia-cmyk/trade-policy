-- Least-privilege Strategy DNA diagnostics for owners and authorized operations staff.

create or replace function public.strategy_compatibility_diagnostic(p_strategy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  profile public.strategy_profiles%rowtype;
  supported_ids constant text[] := array['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','fairValueGap','retestConfirmed','displacement','premiumDiscount','rejectionCandle','volumeConfirmation','volatilityRequirement'];
  mandatory_ids text[] := '{}';
  optional_ids text[] := '{}';
  normalized_ids text[] := '{}';
  unsupported_ids text[] := '{}';
  incomplete_fields text[] := '{}';
  schema_version integer;
  compatibility_status text;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into profile from public.strategy_profiles where id=p_strategy_id;
  if not found then raise exception 'Strategy not found' using errcode='P0002'; end if;
  if profile.user_id<>caller_id and not public.has_staff_permission('system.health') then
    raise exception 'Strategy diagnostic permission denied' using errcode='42501';
  end if;

  with enabled as (
    select r.rule_key,r.mandatory,
      case r.rule_key
        when 'support_resistance' then 'structurePattern' when 'SUPPORT_RESISTANCE' then 'structurePattern'
        when 'market_structure' then 'structurePattern' when 'MARKET_STRUCTURE' then 'structurePattern'
        when 'BREAK_OF_STRUCTURE' then 'bosConfirmed' when 'fvg' then 'fairValueGap'
        when 'FAIR_VALUE_GAP' then 'fairValueGap' when 'breakout_close' then 'bosConfirmed'
        when 'CLOSE_BEYOND_LEVEL' then 'bosConfirmed' when 'trend_alignment' then 'h4TrendAligned'
        when 'HTF_TREND_ALIGNMENT' then 'h4TrendAligned' when 'liquidity_sweep' then 'liquiditySweep'
        when 'LIQUIDITY_GRAB' then 'liquiditySweep' else r.rule_key end normalized_id
    from public.strategy_rules r where r.strategy_id=profile.id and r.user_id=profile.user_id and r.enabled
  )
  select
    coalesce(array_agg(normalized_id) filter(where true),'{}'),
    coalesce(array_agg(normalized_id) filter(where mandatory),'{}'),
    coalesce(array_agg(normalized_id) filter(where not mandatory),'{}'),
    coalesce(array_agg(rule_key) filter(where not normalized_id=any(supported_ids)),'{}')
  into normalized_ids,mandatory_ids,optional_ids,unsupported_ids from enabled;

  schema_version:=case when exists(select 1 from public.strategy_rules where strategy_id=profile.id) then 2 else 1 end;
  if nullif(profile.trend_timeframe,'') is null then incomplete_fields:=array_append(incomplete_fields,'trendTimeframe'); end if;
  if nullif(profile.confirmation_timeframe,'') is null then incomplete_fields:=array_append(incomplete_fields,'confirmationTimeframe'); end if;
  if nullif(profile.entry_timeframe,'') is null then incomplete_fields:=array_append(incomplete_fields,'entryTimeframe'); end if;
  if coalesce(array_length(normalized_ids,1),0)=0 then incomplete_fields:=array_append(incomplete_fields,'evidenceRules'); end if;
  if schema_version=1 then compatibility_status:='LEGACY STRATEGY';
  elsif coalesce(array_length(incomplete_fields,1),0)>0 then compatibility_status:='INCOMPLETE STRATEGY';
  elsif coalesce(array_length(unsupported_ids,1),0)>0 and coalesce(array_length(normalized_ids,1),0)=coalesce(array_length(unsupported_ids,1),0) then compatibility_status:='UNSUPPORTED RULES';
  elsif coalesce(array_length(unsupported_ids,1),0)>0 then compatibility_status:='PARTIALLY SUPPORTED';
  else compatibility_status:='READY FOR LIVE ANALYSIS'; end if;

  return jsonb_build_object(
    'strategyId',profile.id,'strategyName',profile.name,'schemaVersion',schema_version,
    'primaryMethodologyIds',coalesce(profile.strategy_methodologies,'[]'::jsonb),
    'mandatoryEvidenceIds',mandatory_ids,'optionalEvidenceIds',optional_ids,
    'normalizedEvidenceIds',normalized_ids,'supportedEvidenceIds',array(select unnest(normalized_ids) intersect select unnest(supported_ids)),
    'unsupportedEvidenceIds',unsupported_ids,'incompleteFields',incomplete_fields,
    'timeframePolicy',jsonb_build_object('trend',profile.trend_timeframe,'confirmation',profile.confirmation_timeframe,'entry',profile.entry_timeframe,'requireAlignment',profile.require_trend_alignment),
    'confidenceThreshold',coalesce((profile.ai_behavior->>'confidenceThreshold')::numeric,profile.wait_score),
    'compatibilityStatus',compatibility_status
  );
end;
$$;

revoke all on function public.strategy_compatibility_diagnostic(uuid) from public,anon;
grant execute on function public.strategy_compatibility_diagnostic(uuid) to authenticated;
notify pgrst, 'reload schema';
