-- Fix V2 activation insert mapping: trade_records stores strategy payload through rule_snapshot.
-- This keeps active_trades.strategy_snapshot intact while correcting the invalid relation column reference.

create or replace function public.activate_trade_v2(
  p_user_id uuid,
  p_instrument text,
  p_direction text,
  p_entry numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_source_decision_id uuid,
  p_source_report_id uuid,
  p_account_id uuid default null,
  p_strategy_profile_id uuid default null,
  p_strategy_revision_id text default null,
  p_risk_percent numeric default null,
  p_initial_rr numeric default null,
  p_setup_type text default null,
  p_initial_score numeric default null,
  p_initial_analysis jsonb default null,
  p_taken_against_verdict boolean default false,
  p_balance_at_entry numeric default null,
  p_risk_amount numeric default null,
  p_original_verdict text default null,
  p_original_verdict_reason text default null,
  p_override_reason text default null,
  p_override_conditions jsonb default '[]'::jsonb,
  p_activation_mode text default 'READY',
  p_high_impact_news boolean default false,
  p_strategy_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_report_snapshot jsonb;
  v_source_snapshot jsonb;
  v_report_verdict text;
  v_report_override_eligible boolean;
  v_existing_trade_id uuid;
  v_existing_trade_record_id uuid;
  v_trade_record_id uuid;
  v_trade_id uuid;
  v_decision_verdict text;
  v_override_allowed boolean;
  v_balance_at_entry_value numeric;
  v_risk_amount_value numeric;
begin
  if p_user_id is null then
    raise exception 'User context is required for activation.';
  end if;

  if p_instrument is null or p_direction not in ('BUY','SELL') then
    raise exception 'Invalid instrument or direction for activation.';
  end if;

  if p_source_decision_id is null or p_source_report_id is null then
    raise exception 'Decision report activation requires both source_decision_id and source_report_id.';
  end if;

  if p_activation_mode not in ('READY','OVERRIDE') then
    raise exception 'Invalid activation mode.';
  end if;

  if p_account_id is not null and not exists (
    select 1
    from public.trading_accounts a
    where a.id = p_account_id
      and a.user_id = p_user_id
      and a.is_archived = false
  ) then
    raise exception 'The account could not be verified for this user.';
  end if;

  if p_strategy_profile_id is not null and not exists (
    select 1
    from public.strategy_profiles sp
    where sp.id = p_strategy_profile_id
      and sp.user_id = p_user_id
  ) then
    raise exception 'The strategy profile could not be verified for this user.';
  end if;

  if p_strategy_profile_id is not null and p_strategy_revision_id is not null then
    if not exists (
      select 1
      from public.strategy_profiles sp
      where sp.id = p_strategy_profile_id
        and sp.user_id = p_user_id
        and sp.strategy_revision = p_strategy_revision_id
    ) then
      raise exception 'The strategy revision could not be verified for this user.';
    end if;
  end if;

  select ds.snapshot_json
    into v_source_snapshot
  from public.decision_report_sources ds
  where ds.id = p_source_decision_id
    and ds.user_id = p_user_id;

  if not found then
    raise exception 'The originating decision could not be verified.';
  end if;

  v_report_snapshot := v_source_snapshot;

  if not exists (
    select 1
    from public.decision_report_sources d
    join public.decision_reports r
      on r.source_analysis_id = d.source_analysis_id
    where d.id = p_source_decision_id
      and d.user_id = p_user_id
      and r.id = p_source_report_id
      and r.user_id = p_user_id
  ) then
    raise exception 'The decision and report lineage do not match.';
  end if;

  v_report_verdict := coalesce(v_report_snapshot->>'verdict', 'READY');
  v_report_override_eligible := case
    when coalesce(v_report_snapshot->'finalRiskCheck'->>'overrideEligible', '') = '' then false
    else (v_report_snapshot->'finalRiskCheck'->>'overrideEligible')::boolean
  end;

  if p_original_verdict is not null and lower(p_original_verdict) <> lower(v_report_verdict) then
    raise exception 'Caller supplied original verdict does not match the authoritative decision report verdict.';
  end if;

  if v_report_verdict in ('READY', 'AUTHORIZED') then
    if p_activation_mode <> 'READY' then
      raise exception 'READY/AUTHORIZED assertions require READY activation mode.';
    end if;
  elsif v_report_override_eligible then
    if p_activation_mode <> 'OVERRIDE' then
      raise exception 'Non-ready authoritative decisions require OVERRIDE activation mode.';
    end if;

    if btrim(coalesce(p_override_reason, '')) = '' then
      raise exception 'Override activation requires a non-empty override reason.';
    end if;
  else
    raise exception 'This decision is hard-blocked and cannot be overridden.';
  end if;

  if p_account_id is not null then
    if p_balance_at_entry is not null then
      raise exception 'Caller-supplied balance_at_entry is not permitted for account-backed activation.';
    end if;

    if p_risk_amount is not null then
      raise exception 'Caller-supplied risk_amount is not permitted for account-backed activation.';
    end if;

    if p_risk_percent is null or p_risk_percent <= 0 then
      raise exception 'Risk percent must be greater than zero for account-backed activation.';
    end if;

    select a.current_balance
      into v_balance_at_entry_value
    from public.trading_accounts a
    where a.id = p_account_id
      and a.user_id = p_user_id
      and a.is_archived = false;

    if not found then
      raise exception 'The account could not be verified for this user.';
    end if;

    if v_balance_at_entry_value is null or v_balance_at_entry_value <= 0 then
      raise exception 'Invalid monetary risk basis for account-backed activation.';
    end if;

    v_risk_amount_value := v_balance_at_entry_value * (p_risk_percent / 100.0);

    if v_risk_amount_value is null or v_risk_amount_value <= 0 then
      raise exception 'Calculated risk amount must be greater than zero.';
    end if;
  else
    if p_balance_at_entry is null then
      raise exception 'Manual activation requires a valid balance_at_entry.';
    end if;

    if p_risk_percent is null or p_risk_percent <= 0 then
      raise exception 'Risk percent must be greater than zero.';
    end if;

    v_balance_at_entry_value := p_balance_at_entry;

    if v_balance_at_entry_value is null or v_balance_at_entry_value <= 0 then
      raise exception 'Manual activation requires a valid monetary risk basis.';
    end if;

    if p_risk_amount is not null then
      v_risk_amount_value := p_risk_amount;
    else
      v_risk_amount_value := v_balance_at_entry_value * (p_risk_percent / 100.0);
    end if;

    if v_risk_amount_value is null or v_risk_amount_value <= 0 then
      raise exception 'Calculated risk amount must be greater than zero.';
    end if;
  end if;

  v_decision_verdict := v_report_verdict;
  v_override_allowed := false;

  if p_source_decision_id is not null then
    select a.id, a.trade_record_id
      into v_existing_trade_id, v_existing_trade_record_id
    from public.active_trades a
    where a.user_id = p_user_id
      and a.source_decision_id = p_source_decision_id
    limit 1;

    if v_existing_trade_id is not null then
      return jsonb_build_object(
        'trade_record_id', v_existing_trade_record_id,
        'active_trade_id', v_existing_trade_id,
        'lifecycle_status', 'ACTIVE',
        'active_trade_created', false,
        'audit_event_recorded', true,
        'duplicate', true
      );
    end if;
  end if;

  if exists (
    select 1
    from public.active_trades a
    where a.user_id = p_user_id
      and a.instrument = p_instrument
      and a.status = 'OPEN'
    limit 1
  ) then
    raise exception 'You already have an open trade for this instrument.';
  end if;

  if p_activation_mode = 'OVERRIDE' then
    v_override_allowed := v_report_override_eligible and btrim(coalesce(p_override_reason, '')) <> '';
    if not v_override_allowed then
      raise exception 'Override activation requires authoritative override eligibility and a non-empty reason.';
    end if;
  end if;

  begin
    insert into public.trade_records (
      user_id,
      source,
      status,
      instrument,
      direction,
      setup_type,
      session,
      entry,
      stop_loss,
      take_profit,
      rr,
      score,
      verdict,
      chart_analysis,
      rule_snapshot,
      created_at,
      updated_at,
      account_id,
      balance_at_entry,
      risk_amount,
      strategy_profile_id,
      strategy_name_at_entry,
      original_verdict,
      original_verdict_reason,
      taken_against_verdict,
      override_reason,
      override_conditions,
      activation_mode,
      strategy_revision_id,
      source_decision_id,
      source_report_id
    ) values (
      p_user_id,
      'EXECUTED',
      'OPEN',
      p_instrument,
      p_direction,
      p_setup_type,
      null,
      p_entry,
      p_stop_loss,
      p_take_profit,
      p_initial_rr,
      p_initial_score,
      coalesce(p_original_verdict, v_report_verdict),
      p_initial_analysis,
      p_strategy_snapshot,
      now(),
      now(),
      p_account_id,
      v_balance_at_entry_value,
      v_risk_amount_value,
      p_strategy_profile_id,
      null,
      p_original_verdict,
      p_original_verdict_reason,
      p_taken_against_verdict or p_activation_mode = 'OVERRIDE',
      p_override_reason,
      coalesce(p_override_conditions, '[]'::jsonb),
      p_activation_mode,
      p_strategy_revision_id,
      p_source_decision_id,
      p_source_report_id
    )
    returning id into v_trade_record_id;

    insert into public.active_trades (
      user_id,
      account_id,
      balance_at_entry,
      risk_amount,
      strategy_profile_id,
      strategy_name_at_entry,
      strategy_snapshot,
      strategy_version,
      strategy_revision_id,
      trade_record_id,
      source_decision_id,
      source_report_id,
      instrument,
      direction,
      entry,
      stop_loss,
      take_profit,
      risk_percent,
      initial_rr,
      setup_type,
      initial_score,
      initial_analysis,
      status,
      current_price,
      current_r,
      mfe_r,
      mae_r,
      taken_against_verdict,
      original_verdict,
      original_verdict_reason,
      override_reason,
      override_conditions,
      activation_mode,
      opened_at,
      updated_at
    ) values (
      p_user_id,
      p_account_id,
      v_balance_at_entry_value,
      v_risk_amount_value,
      p_strategy_profile_id,
      null,
      p_strategy_snapshot,
      null,
      p_strategy_revision_id,
      v_trade_record_id,
      p_source_decision_id,
      p_source_report_id,
      p_instrument,
      p_direction,
      p_entry,
      p_stop_loss,
      p_take_profit,
      p_risk_percent,
      p_initial_rr,
      p_setup_type,
      p_initial_score,
      p_initial_analysis,
      'OPEN',
      p_entry,
      0,
      0,
      0,
      p_taken_against_verdict or p_activation_mode = 'OVERRIDE',
      coalesce(p_original_verdict, v_report_verdict),
      p_original_verdict_reason,
      p_override_reason,
      coalesce(p_override_conditions, '[]'::jsonb),
      p_activation_mode,
      now(),
      now()
    )
    on conflict (user_id, source_decision_id)
    where source_decision_id is not null
    do nothing
    returning id into v_trade_id;

    if v_trade_id is null then
      select a.id, a.trade_record_id
        into v_existing_trade_id, v_existing_trade_record_id
      from public.active_trades a
      where a.user_id = p_user_id
        and a.source_decision_id = p_source_decision_id
      limit 1;

      if v_existing_trade_id is not null then
        delete from public.trade_records
        where id = v_trade_record_id
          and user_id = p_user_id
          and source = 'EXECUTED'
          and status = 'OPEN';

        return jsonb_build_object(
          'trade_record_id', v_existing_trade_record_id,
          'active_trade_id', v_existing_trade_id,
          'lifecycle_status', 'ACTIVE',
          'active_trade_created', false,
          'audit_event_recorded', true,
          'duplicate', true
        );
      end if;

      raise exception 'Duplicate activation race detected.';
    end if;

    insert into public.active_trade_events (
      user_id,
      trade_id,
      event_type,
      verdict,
      current_price,
      current_r,
      analysis
    ) values (
      p_user_id,
      v_trade_id,
      'TRADE_ACTIVATED',
      coalesce(p_original_verdict, v_report_verdict),
      p_entry,
      0,
      jsonb_build_object(
        'activation_mode', p_activation_mode,
        'source_decision_id', p_source_decision_id,
        'source_report_id', p_source_report_id,
        'override_reason', p_override_reason,
        'taken_against_verdict', p_taken_against_verdict or p_activation_mode = 'OVERRIDE',
        'high_impact_news', p_high_impact_news,
        'strategy_snapshot', p_strategy_snapshot,
        'authoritative_verdict', v_report_verdict,
        'override_eligible', v_report_override_eligible
      )
    );

    return jsonb_build_object(
      'trade_record_id', v_trade_record_id,
      'active_trade_id', v_trade_id,
      'lifecycle_status', 'ACTIVE',
      'active_trade_created', true,
      'audit_event_recorded', true,
      'duplicate', false
    );
  exception when unique_violation then
    if p_source_decision_id is not null then
      select a.id, a.trade_record_id
        into v_existing_trade_id, v_existing_trade_record_id
      from public.active_trades a
      where a.user_id = p_user_id
        and a.source_decision_id = p_source_decision_id
      limit 1;

      if v_existing_trade_id is not null then
        if v_trade_record_id is not null then
          delete from public.trade_records
          where id = v_trade_record_id
            and user_id = p_user_id
            and source = 'EXECUTED'
            and status = 'OPEN';
        end if;

        return jsonb_build_object(
          'trade_record_id', v_existing_trade_record_id,
          'active_trade_id', v_existing_trade_id,
          'lifecycle_status', 'ACTIVE',
          'active_trade_created', false,
          'audit_event_recorded', true,
          'duplicate', true
        );
      end if;
    end if;

    raise;
  end;
end;
$$;

alter function public.activate_trade_v2(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) owner to postgres;

revoke all on function public.activate_trade_v2(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) from public;
revoke execute on function public.activate_trade_v2(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) from anon;
revoke execute on function public.activate_trade_v2(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) from authenticated;
grant execute on function public.activate_trade_v2(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) to service_role;

comment on function public.activate_trade_v2(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  boolean,
  numeric,
  numeric,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) is 'Server-owned V2 activation boundary that creates exactly one successful activation, enforces authoritative decision lineage, blocks hard overrides, and prevents duplicate source_decision activations.';

notify pgrst, 'reload schema';
