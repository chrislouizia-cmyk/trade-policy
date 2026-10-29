-- Persist the validated trade session inside the same transaction that creates
-- the trade record, active trade, and activation event. The existing 28-arg
-- implementation remains the internal activation primitive; this overload is
-- the server-facing contract used by the application.

create or replace function public.activate_trade_atomically_v1(
  p_user_id uuid,
  p_instrument text,
  p_direction text,
  p_entry numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_risk_percent numeric,
  p_initial_rr numeric,
  p_session text,
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
  v_activation jsonb;
  v_trade_record_id uuid;
  v_stored_session text;
begin
  if nullif(btrim(p_session), '') is null then
    raise exception 'The original trade session is required.';
  end if;

  select public.activate_trade_atomically_v1(
    p_user_id => p_user_id,
    p_instrument => p_instrument,
    p_direction => p_direction,
    p_entry => p_entry,
    p_stop_loss => p_stop_loss,
    p_take_profit => p_take_profit,
    p_risk_percent => p_risk_percent,
    p_initial_rr => p_initial_rr,
    p_account_id => p_account_id,
    p_balance_at_entry => p_balance_at_entry,
    p_risk_amount => p_risk_amount,
    p_strategy_profile_id => p_strategy_profile_id,
    p_strategy_name_at_entry => p_strategy_name_at_entry,
    p_strategy_version => p_strategy_version,
    p_strategy_revision_id => p_strategy_revision_id,
    p_source_decision_id => p_source_decision_id,
    p_source_report_id => p_source_report_id,
    p_setup_type => p_setup_type,
    p_initial_score => p_initial_score,
    p_initial_analysis => p_initial_analysis,
    p_taken_against_verdict => p_taken_against_verdict,
    p_original_verdict => p_original_verdict,
    p_original_verdict_reason => p_original_verdict_reason,
    p_override_reason => p_override_reason,
    p_override_conditions => p_override_conditions,
    p_activation_mode => p_activation_mode,
    p_high_impact_news => p_high_impact_news,
    p_strategy_snapshot => p_strategy_snapshot
  ) into v_activation;

  v_trade_record_id := nullif(v_activation ->> 'trade_record_id', '')::uuid;
  if v_trade_record_id is null then
    raise exception 'Trade activation did not return a trade record for session persistence.';
  end if;

  select tr.session
    into v_stored_session
  from public.trade_records tr
  where tr.id = v_trade_record_id
    and tr.user_id = p_user_id
  for update;

  if not found then
    raise exception 'The activated trade record could not be verified for session persistence.';
  end if;

  if v_stored_session is not null and v_stored_session <> btrim(p_session) then
    raise exception 'The original trade session conflicts with the existing activation record.';
  end if;

  if v_stored_session is null then
    update public.trade_records
      set session = btrim(p_session), updated_at = now()
    where id = v_trade_record_id
      and user_id = p_user_id;
  end if;

  return v_activation;
end;
$$;

revoke all on function public.activate_trade_atomically_v1(
  uuid,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
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
  text,
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
