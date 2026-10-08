-- Trade Police v21: stage-aware diagnostics around the atomic activation boundary.
-- This is a temporary, additive diagnostic replacement for the production function.
-- It preserves the original security mode, signature, grant shape, and unique-violation recovery path.

create or replace function public.activate_trade_atomically_v1(
  p_user_id uuid,
  p_instrument text,
  p_direction text,
  p_entry numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_risk_percent numeric,
  p_initial_rr numeric,
  p_account_id uuid default null,
  p_balance_at_entry numeric default null,
  p_risk_amount numeric default null,
  p_strategy_profile_id uuid default null,
  p_strategy_name_at_entry text default null,
  p_strategy_version text default null,
  p_strategy_revision_id text default null,
  p_source_decision_id uuid default null,
  p_source_report_id uuid default null,
  p_setup_type text default null,
  p_initial_score numeric default null,
  p_initial_analysis jsonb default null,
  p_taken_against_verdict boolean default false,
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
security invoker
set search_path = public
as $$
declare
  v_trade_record_id uuid;
  v_trade_id uuid;
  v_existing_trade_id uuid;
  v_existing_trade_record_id uuid;
  v_event_type text;
begin
  if p_user_id is null then
    raise exception 'User context is required for activation.' using hint = 'The API route authenticates the caller and passes the validated user_id to the server-owned activation boundary.';
  end if;

  if p_instrument is null or p_direction not in ('BUY', 'SELL') then
    raise exception 'Invalid instrument or direction for activation.';
  end if;

  if p_activation_mode not in ('READY', 'OVERRIDE') then
    raise exception 'Invalid activation mode.';
  end if;

  if p_account_id is not null then
    begin
      if not exists (
        select 1 from public.trading_accounts a
        where a.id = p_account_id and a.user_id = p_user_id and a.is_archived = false
      ) then
        raise exception 'ACTIVATION_STAGE=STAGE_01_ACCOUNT_VALIDATION | The account could not be verified for this user.';
      end if;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_01_ACCOUNT_VALIDATION | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;
  end if;

  if p_strategy_profile_id is not null then
    begin
      if not exists (
        select 1 from public.strategy_profiles sp
        where sp.id = p_strategy_profile_id and sp.user_id = p_user_id
      ) then
        raise exception 'ACTIVATION_STAGE=STAGE_02_STRATEGY_VALIDATION | The strategy profile could not be verified for this user.';
      end if;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_02_STRATEGY_VALIDATION | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;
  end if;

  if p_source_decision_id is not null then
    begin
      if not exists (
        select 1 from public.decision_report_sources d
        where d.id = p_source_decision_id and d.user_id = p_user_id
      ) then
        raise exception 'ACTIVATION_STAGE=STAGE_03_DECISION_VALIDATION | The originating decision could not be verified.';
      end if;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_03_DECISION_VALIDATION | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;
  end if;

  if p_source_report_id is not null then
    begin
      if not exists (
        select 1 from public.decision_reports d
        where d.id = p_source_report_id and d.user_id = p_user_id
      ) then
        raise exception 'ACTIVATION_STAGE=STAGE_04_REPORT_VALIDATION | The originating decision report could not be verified.';
      end if;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_04_REPORT_VALIDATION | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;
  end if;

  if p_source_decision_id is not null and p_source_report_id is not null then
    begin
      if not exists (
        select 1
        from public.decision_report_sources d
        join public.decision_reports r
          on r.source_analysis_id = d.source_analysis_id
         and r.id = p_source_report_id
        where d.id = p_source_decision_id
          and d.user_id = p_user_id
          and r.user_id = p_user_id
      ) then
        raise exception 'ACTIVATION_STAGE=STAGE_05_LINEAGE_VALIDATION | The decision and report lineage do not match.';
      end if;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_05_LINEAGE_VALIDATION | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;
  end if;

  if p_source_decision_id is not null then
    begin
      select a.id, a.trade_record_id
        into v_existing_trade_id, v_existing_trade_record_id
      from public.active_trades a
      where a.user_id = p_user_id
        and a.source_decision_id = p_source_decision_id
      limit 1;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_06_EXISTING_DECISION_ACTIVE_TRADE_SELECT | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;

    if v_existing_trade_id is not null then
      return jsonb_build_object(
        'trade_record_id', v_existing_trade_record_id,
        'active_trade_id', v_existing_trade_id,
        'lifecycle_status', 'ACTIVE',
        'active_trade_created', true,
        'audit_event_recorded', true,
        'duplicate', true
      );
    end if;
  end if;

  begin
    if exists (
      select 1
      from public.active_trades a
      where a.user_id = p_user_id
        and a.instrument = p_instrument
        and a.status = 'OPEN'
      limit 1
    ) then
      raise exception 'ACTIVATION_STAGE=STAGE_07_OPEN_INSTRUMENT_ACTIVE_TRADE_SELECT | You already have an open trade for this instrument.';
    end if;
  exception when others then
    if SQLSTATE = '23505' then
      raise;
    else
      raise exception 'ACTIVATION_STAGE=STAGE_07_OPEN_INSTRUMENT_ACTIVE_TRADE_SELECT | %', SQLERRM using errcode = SQLSTATE;
    end if;
  end;

  v_event_type := case when p_taken_against_verdict then 'TRADE_TAKEN_AGAINST_VERDICT' else 'TRADE_TAKEN' end;

  begin
    insert into public.trade_records (
      user_id,
      account_id,
      balance_at_entry,
      risk_amount,
      strategy_profile_id,
      strategy_name_at_entry,
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
      strategy_snapshot,
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
      p_account_id,
      p_balance_at_entry,
      p_risk_amount,
      p_strategy_profile_id,
      p_strategy_name_at_entry,
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
      coalesce(p_original_verdict, 'READY'),
      p_initial_analysis,
      p_strategy_snapshot,
      now(),
      now(),
      p_strategy_snapshot,
      p_original_verdict,
      p_original_verdict_reason,
      p_taken_against_verdict,
      p_override_reason,
      coalesce(p_override_conditions, '[]'::jsonb),
      p_activation_mode,
      p_strategy_revision_id,
      p_source_decision_id,
      p_source_report_id
    )
    returning id into v_trade_record_id;
  exception when others then
    if SQLSTATE = '23505' then
      raise;
    else
      raise exception 'ACTIVATION_STAGE=STAGE_08_TRADE_RECORD_INSERT | %', SQLERRM using errcode = SQLSTATE;
    end if;
  end;

  begin
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
      p_balance_at_entry,
      p_risk_amount,
      p_strategy_profile_id,
      p_strategy_name_at_entry,
      p_strategy_snapshot,
      p_strategy_version,
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
      p_taken_against_verdict,
      p_original_verdict,
      p_original_verdict_reason,
      p_override_reason,
      coalesce(p_override_conditions, '[]'::jsonb),
      p_activation_mode,
      now(),
      now()
    )
    returning id into v_trade_id;
  exception when others then
    if SQLSTATE = '23505' then
      raise;
    else
      raise exception 'ACTIVATION_STAGE=STAGE_09_ACTIVE_TRADE_INSERT | %', SQLERRM using errcode = SQLSTATE;
    end if;
  end;

  begin
    insert into public.active_trade_events (
      user_id,
      trade_id,
      event_type,
      verdict,
      current_price,
      current_r,
      analysis,
      created_at
    ) values (
      p_user_id,
      v_trade_id,
      v_event_type,
      case when p_taken_against_verdict then 'OPEN — AGAINST ' || coalesce(p_original_verdict, 'VERDICT') else 'OPEN' end,
      p_entry,
      0,
      jsonb_build_object(
        'original_analysis', p_initial_analysis,
        'original_verdict', p_original_verdict,
        'original_verdict_reason', p_original_verdict_reason,
        'override_reason', p_override_reason,
        'high_impact_news', p_high_impact_news,
        'activation_mode', p_activation_mode
      ),
      now()
    );
  exception when others then
    if SQLSTATE = '23505' then
      raise;
    else
      raise exception 'ACTIVATION_STAGE=STAGE_10_ACTIVE_TRADE_EVENT_INSERT | %', SQLERRM using errcode = SQLSTATE;
    end if;
  end;

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
    begin
      select a.id, a.trade_record_id
        into v_existing_trade_id, v_existing_trade_record_id
      from public.active_trades a
      where a.user_id = p_user_id
        and a.source_decision_id = p_source_decision_id
      limit 1;
    exception when others then
      if SQLSTATE = '23505' then
        raise;
      else
        raise exception 'ACTIVATION_STAGE=STAGE_11_UNIQUE_VIOLATION_RECOVERY_SELECT | %', SQLERRM using errcode = SQLSTATE;
      end if;
    end;

    if v_existing_trade_id is not null then
      return jsonb_build_object(
        'trade_record_id', v_existing_trade_record_id,
        'active_trade_id', v_existing_trade_id,
        'lifecycle_status', 'ACTIVE',
        'active_trade_created', true,
        'audit_event_recorded', true,
        'duplicate', true
      );
    end if;
  end if;

  raise;
end;
$$;

create unique index if not exists active_trades_user_source_decision_unique
  on public.active_trades (user_id, source_decision_id)
  where source_decision_id is not null;

revoke all on function public.activate_trade_atomically_v1(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  numeric,
  numeric,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  jsonb,
  boolean,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) from public, anon, authenticated;

grant execute on function public.activate_trade_atomically_v1(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  uuid,
  numeric,
  numeric,
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  numeric,
  jsonb,
  boolean,
  text,
  text,
  text,
  jsonb,
  text,
  boolean,
  jsonb
) to service_role;

notify pgrst, 'reload schema';
