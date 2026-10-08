-- Make Marketplace qualification and release evidence mathematically honest.
-- A release is immutable, but only the current revision of each source strategy
-- belongs in the active qualification board. Historical releases remain intact.

alter table public.marketplace_strategy_candidates
  add column if not exists is_current_revision boolean not null default true;

with ranked as (
  select id,
         row_number() over (
           partition by source_strategy_id
           order by updated_at desc, created_at desc, id desc
         ) as revision_rank
  from public.marketplace_strategy_candidates
)
update public.marketplace_strategy_candidates candidate
set is_current_revision = ranked.revision_rank = 1
from ranked
where ranked.id = candidate.id
  and candidate.is_current_revision is distinct from (ranked.revision_rank = 1);

create index if not exists marketplace_candidates_current_revision_idx
  on public.marketplace_strategy_candidates(updated_at desc)
  where is_current_revision = true;

create or replace function public.evaluate_marketplace_strategy_candidate(
  p_source_strategy_id uuid,
  p_source_strategy_revision_id text
) returns public.marketplace_strategy_candidates
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile public.strategy_profiles%rowtype;
  v_policy public.marketplace_qualification_policies%rowtype;
  v_first_activity timestamptz;
  v_last_activity timestamptz;
  v_backtests integer := 0;
  v_decisions integer := 0;
  v_trades integer := 0;
  v_violations integer := 0;
  v_adherence numeric;
  v_drawdown numeric;
  v_candidate public.marketplace_strategy_candidates%rowtype;
  v_status text;
begin
  if p_source_strategy_id is null or nullif(btrim(p_source_strategy_revision_id), '') is null then
    raise exception 'Strategy and exact revision are required';
  end if;

  select * into v_profile
  from public.strategy_profiles
  where id = p_source_strategy_id and is_archived = false;
  if not found then raise exception 'Active strategy profile not found'; end if;

  select * into v_policy
  from public.marketplace_qualification_policies
  where active = true
  limit 1;
  if not found then raise exception 'Active Marketplace qualification policy not found'; end if;

  select count(*)::integer into v_backtests
  from public.backtest_runs
  where strategy_profile_id = p_source_strategy_id
    and strategy_revision_id = p_source_strategy_revision_id
    and status = 'COMPLETED';

  select count(*)::integer into v_decisions
  from public.decision_reports
  where strategy_id = p_source_strategy_id
    and strategy_revision_id = p_source_strategy_revision_id
    and user_id = v_profile.user_id;

  select count(*)::integer,
         count(*) filter (where coalesce(taken_against_verdict, false))::integer,
         case when count(*) > 0 then
           round(100.0 * count(*) filter (where not coalesce(taken_against_verdict, false)) / count(*), 2)
         else null end
    into v_trades, v_violations, v_adherence
  from public.active_trades
  where strategy_profile_id = p_source_strategy_id
    and strategy_revision_id = p_source_strategy_revision_id
    and user_id = v_profile.user_id
    and status = 'CLOSED'
    and closed_at is not null
    and result_r is not null;

  with ordered as (
    select id,
           coalesce(closed_at, created_at) as activity_at,
           sum(result_r) over (
             order by coalesce(closed_at, created_at), id
             rows between unbounded preceding and current row
           ) as equity_r
    from public.active_trades
    where strategy_profile_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
      and user_id = v_profile.user_id
      and status = 'CLOSED'
      and closed_at is not null
      and result_r is not null
  ), peaks as (
    select equity_r,
           greatest(0, max(equity_r) over (
             order by activity_at, id
             rows between unbounded preceding and current row
           )) as peak_r
    from ordered
  )
  select case when v_trades > 0 then round(coalesce(max(peak_r - equity_r), 0), 4) else null end
  into v_drawdown
  from peaks;

  -- Backtests are historical simulations and market-data reads are not behavior.
  -- Observation time begins only with a saved live decision or a closed recorded trade.
  select min(activity_at), max(activity_at)
    into v_first_activity, v_last_activity
  from (
    select created_at as activity_at
    from public.decision_reports
    where strategy_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
      and user_id = v_profile.user_id
    union all
    select closed_at
    from public.active_trades
    where strategy_profile_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
      and user_id = v_profile.user_id
      and status = 'CLOSED'
      and closed_at is not null
      and result_r is not null
  ) activity;

  update public.marketplace_strategy_candidates
  set is_current_revision = false,
      updated_at = now()
  where source_strategy_id = p_source_strategy_id
    and source_strategy_revision_id <> p_source_strategy_revision_id
    and is_current_revision = true;

  insert into public.marketplace_strategy_candidates(
    source_strategy_id, owner_user_id, source_strategy_revision_id, qualification_policy_version,
    observation_started_at, last_verified_activity_at, completed_backtests, saved_decisions, closed_trades,
    adherence_percent, critical_violations, maximum_drawdown_r, is_current_revision
  ) values (
    p_source_strategy_id, v_profile.user_id, p_source_strategy_revision_id, v_policy.version,
    coalesce(v_first_activity, now()), v_last_activity, v_backtests, v_decisions, v_trades,
    v_adherence, v_violations, v_drawdown, true
  ) on conflict(source_strategy_id, source_strategy_revision_id) do update set
    qualification_policy_version = excluded.qualification_policy_version,
    observation_started_at = case
      when excluded.last_verified_activity_at is null then public.marketplace_strategy_candidates.observation_started_at
      when public.marketplace_strategy_candidates.last_verified_activity_at is null then excluded.observation_started_at
      else least(public.marketplace_strategy_candidates.observation_started_at, excluded.observation_started_at)
    end,
    last_verified_activity_at = excluded.last_verified_activity_at,
    completed_backtests = excluded.completed_backtests,
    saved_decisions = excluded.saved_decisions,
    closed_trades = excluded.closed_trades,
    adherence_percent = excluded.adherence_percent,
    critical_violations = excluded.critical_violations,
    maximum_drawdown_r = excluded.maximum_drawdown_r,
    is_current_revision = true,
    updated_at = now()
  returning * into v_candidate;

  v_candidate.observation_days := case
    when v_candidate.last_verified_activity_at is null then 0
    else greatest(0, floor(extract(epoch from (now() - v_candidate.observation_started_at)) / 86400))::integer
  end;

  if v_candidate.qualification_status = 'ARCHIVED' then
    v_status := 'ARCHIVED';
  elsif v_candidate.observation_days < v_policy.minimum_observation_days or v_trades < v_policy.minimum_closed_trades then
    v_status := case when v_trades = 0 and v_decisions = 0 and v_backtests = 0 then 'OBSERVING' else 'INSUFFICIENT_DATA' end;
  elsif coalesce(v_adherence, 0) < v_policy.minimum_adherence_percent
     or v_violations > v_policy.maximum_critical_violations
     or coalesce(v_drawdown, 0) > v_policy.maximum_drawdown_r then
    v_status := 'INSUFFICIENT_DATA';
  elsif v_candidate.qualification_status = 'APPROVED' and v_candidate.owner_consent_status = 'GRANTED' then
    v_status := 'APPROVED';
  elsif v_candidate.qualification_status = 'DECLINED' then
    v_status := 'DECLINED';
  elsif v_candidate.owner_consent_status in ('DECLINED', 'REVOKED') then
    v_status := 'DECLINED';
  elsif v_candidate.owner_consent_status = 'GRANTED' then
    v_status := 'UNDER_REVIEW';
  else
    v_status := 'OWNER_CONSENT_PENDING';
  end if;

  update public.marketplace_strategy_candidates
  set observation_days = v_candidate.observation_days,
      qualification_status = v_status,
      owner_consent_status = case
        when v_status = 'OWNER_CONSENT_PENDING' and owner_consent_status = 'NOT_REQUESTED' then 'PENDING'
        else owner_consent_status
      end,
      qualified_at = case
        when v_status in ('OWNER_CONSENT_PENDING', 'UNDER_REVIEW') then coalesce(qualified_at, now())
        else qualified_at
      end,
      updated_at = now()
  where id = v_candidate.id
  returning * into v_candidate;

  return v_candidate;
end;
$$;

revoke all on function public.evaluate_marketplace_strategy_candidate(uuid, text) from public, anon, authenticated;
grant execute on function public.evaluate_marketplace_strategy_candidate(uuid, text) to service_role;

create or replace function public.refresh_marketplace_release_verified_metrics(
  p_marketplace_release_id uuid,
  p_source_strategy_id uuid,
  p_source_strategy_revision_id text
)
returns public.marketplace_release_verified_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release public.marketplace_strategy_releases%rowtype;
  v_creator public.profiles%rowtype;
  v_trade_count integer := 0;
  v_observation_started_at timestamptz;
  v_last_verified_activity_at timestamptz;
  v_row public.marketplace_release_verified_metrics%rowtype;
begin
  if p_marketplace_release_id is null or p_source_strategy_id is null or nullif(btrim(p_source_strategy_revision_id), '') is null then
    raise exception 'Release, strategy, and exact revision are required';
  end if;

  select * into v_release
  from public.marketplace_strategy_releases
  where id = p_marketplace_release_id
  for update;
  if not found then raise exception 'Marketplace release not found'; end if;

  if v_release.source_strategy_id <> p_source_strategy_id
     or v_release.source_strategy_revision_id <> p_source_strategy_revision_id then
    raise exception 'Release strategy revision mismatch';
  end if;

  select * into v_creator
  from public.profiles
  where id = v_release.creator_user_id
  limit 1;

  -- The immutable release proves which source strategy and exact revision own the
  -- evidence. Requiring marketplace_release_id on pre-release activity would erase
  -- the observation record that qualified the release in the first place.
  select count(*)::integer,
         count(*) filter (where result_r > 0.05)::integer,
         count(*) filter (where result_r < -0.05)::integer,
         count(*) filter (where result_r between -0.05 and 0.05)::integer,
         case when count(*) > 0 then round(100.0 * count(*) filter (where result_r > 0.05) / count(*), 2) else null end,
         case when count(*) > 0 then round(100.0 * count(*) filter (where result_r < -0.05) / count(*), 2) else null end,
         case when count(*) > 0 then round(sum(result_r), 4) else null end,
         case when count(*) > 0 then round(avg(result_r), 4) else null end,
         case when count(*) > 0 then round(avg(result_r), 4) else null end,
         case when abs(coalesce(sum(result_r) filter (where result_r < 0), 0)) > 0
              then round(coalesce(sum(result_r) filter (where result_r > 0), 0) / abs(sum(result_r) filter (where result_r < 0)), 4)
              else null end,
         max(result_r),
         min(result_r),
         case when count(*) > 0 then round(100.0 * count(*) filter (where not coalesce(taken_against_verdict, false)) / count(*), 2) else null end,
         count(*) filter (where coalesce(taken_against_verdict, false))::integer
    into v_trade_count, v_row.wins, v_row.losses, v_row.break_even,
         v_row.win_rate, v_row.loss_rate, v_row.total_r, v_row.average_r,
         v_row.expectancy_r, v_row.profit_factor, v_row.best_trade_r,
         v_row.worst_trade_r, v_row.strategy_adherence_rate, v_row.rule_violation_count
  from public.active_trades
  where user_id = v_release.creator_user_id
    and strategy_profile_id = p_source_strategy_id
    and strategy_revision_id = p_source_strategy_revision_id
    and status = 'CLOSED'
    and closed_at is not null
    and result_r is not null;

  with ordered as (
    select id,
           coalesce(closed_at, created_at) as activity_at,
           sum(result_r) over (
             order by coalesce(closed_at, created_at), id
             rows between unbounded preceding and current row
           ) as equity_r
    from public.active_trades
    where user_id = v_release.creator_user_id
      and strategy_profile_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
      and status = 'CLOSED'
      and closed_at is not null
      and result_r is not null
  ), peaks as (
    select equity_r,
           greatest(0, max(equity_r) over (
             order by activity_at, id
             rows between unbounded preceding and current row
           )) as peak_r
    from ordered
  )
  select case when v_trade_count > 0 then round(coalesce(max(peak_r - equity_r), 0), 4) else null end
  into v_row.max_drawdown_r
  from peaks;

  with classified as (
    select id,
           coalesce(closed_at, created_at) as activity_at,
           case when result_r > 0.05 then 'WIN'
                when result_r < -0.05 then 'LOSS'
                else 'BREAKEVEN' end as result_class
    from public.active_trades
    where user_id = v_release.creator_user_id
      and strategy_profile_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
      and status = 'CLOSED'
      and closed_at is not null
      and result_r is not null
  ), grouped as (
    select result_class,
           row_number() over (order by activity_at, id)
             - row_number() over (partition by result_class order by activity_at, id) as streak_group
    from classified
  ), streaks as (
    select result_class, streak_group, count(*)::integer as streak_length
    from grouped
    where result_class in ('WIN', 'LOSS')
    group by result_class, streak_group
  )
  select max(streak_length) filter (where result_class = 'WIN'),
         max(streak_length) filter (where result_class = 'LOSS')
    into v_row.max_win_streak, v_row.max_loss_streak
  from streaks;

  select min(activity_at), max(activity_at)
    into v_observation_started_at, v_last_verified_activity_at
  from (
    select created_at as activity_at
    from public.decision_reports
    where user_id = v_release.creator_user_id
      and strategy_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
    union all
    select closed_at
    from public.active_trades
    where user_id = v_release.creator_user_id
      and strategy_profile_id = p_source_strategy_id
      and strategy_revision_id = p_source_strategy_revision_id
      and status = 'CLOSED'
      and closed_at is not null
      and result_r is not null
  ) activity;

  select count(*) filter (where verdict = 'AUTHORIZED')::integer,
         count(*) filter (where verdict in ('REJECTED', 'WAIT'))::integer
    into v_row.approved_trade_count, v_row.rejected_or_no_trade_count
  from public.decision_reports
  where user_id = v_release.creator_user_id
    and strategy_id = p_source_strategy_id
    and strategy_revision_id = p_source_strategy_revision_id;

  v_row.creator_user_id := v_release.creator_user_id;
  v_row.creator_display_name := coalesce(v_creator.display_name, 'Trade Police');
  v_row.member_since := v_creator.created_at;
  v_row.total_verified_platform_trades := (
    select count(*)::integer
    from public.active_trades
    where user_id = v_release.creator_user_id
      and status = 'CLOSED'
      and closed_at is not null
      and result_r is not null
  );
  v_row.total_marketplace_strategies := (
    select count(distinct source_strategy_id)::integer
    from public.marketplace_strategy_releases
    where creator_user_id = v_release.creator_user_id
  );
  v_row.source_strategy_id := p_source_strategy_id;
  v_row.source_strategy_revision_id := p_source_strategy_revision_id;
  v_row.marketplace_release_id := p_marketplace_release_id;
  v_row.observation_started_at := v_observation_started_at;
  v_row.last_verified_activity_at := v_last_verified_activity_at;
  v_row.observation_days := case
    when v_observation_started_at is null then null
    else greatest(0, floor(extract(epoch from (now() - v_observation_started_at)) / 86400.0))::integer
  end;
  v_row.metric_status := case
    when v_trade_count > 0 then 'RECORDED_RESULTS_AVAILABLE'
    else 'NOT_ENOUGH_VERIFIED_DATA'
  end;
  v_row.outside_session_count := null;
  v_row.risk_violation_count := null;
  v_row.created_at := now();
  v_row.updated_at := now();

  insert into public.marketplace_release_verified_metrics (
    creator_user_id, creator_display_name, member_since, total_verified_platform_trades,
    total_marketplace_strategies, source_strategy_id, source_strategy_revision_id,
    marketplace_release_id, observation_started_at, last_verified_activity_at,
    observation_days, metric_status, wins, losses, break_even, win_rate, loss_rate,
    total_r, average_r, expectancy_r, profit_factor, best_trade_r, worst_trade_r,
    max_win_streak, max_loss_streak, max_drawdown_r, strategy_adherence_rate,
    rule_violation_count, outside_session_count, risk_violation_count,
    approved_trade_count, rejected_or_no_trade_count, created_at, updated_at
  ) values (
    v_row.creator_user_id, v_row.creator_display_name, v_row.member_since,
    v_row.total_verified_platform_trades, v_row.total_marketplace_strategies,
    v_row.source_strategy_id, v_row.source_strategy_revision_id,
    v_row.marketplace_release_id, v_row.observation_started_at,
    v_row.last_verified_activity_at, v_row.observation_days, v_row.metric_status,
    v_row.wins, v_row.losses, v_row.break_even, v_row.win_rate, v_row.loss_rate,
    v_row.total_r, v_row.average_r, v_row.expectancy_r, v_row.profit_factor,
    v_row.best_trade_r, v_row.worst_trade_r, v_row.max_win_streak,
    v_row.max_loss_streak, v_row.max_drawdown_r, v_row.strategy_adherence_rate,
    v_row.rule_violation_count, v_row.outside_session_count,
    v_row.risk_violation_count, v_row.approved_trade_count,
    v_row.rejected_or_no_trade_count, v_row.created_at, v_row.updated_at
  )
  on conflict (source_strategy_id, source_strategy_revision_id, marketplace_release_id)
  do update set
    creator_display_name = excluded.creator_display_name,
    member_since = excluded.member_since,
    total_verified_platform_trades = excluded.total_verified_platform_trades,
    total_marketplace_strategies = excluded.total_marketplace_strategies,
    observation_started_at = excluded.observation_started_at,
    last_verified_activity_at = excluded.last_verified_activity_at,
    observation_days = excluded.observation_days,
    metric_status = excluded.metric_status,
    wins = excluded.wins,
    losses = excluded.losses,
    break_even = excluded.break_even,
    win_rate = excluded.win_rate,
    loss_rate = excluded.loss_rate,
    total_r = excluded.total_r,
    average_r = excluded.average_r,
    expectancy_r = excluded.expectancy_r,
    profit_factor = excluded.profit_factor,
    best_trade_r = excluded.best_trade_r,
    worst_trade_r = excluded.worst_trade_r,
    max_win_streak = excluded.max_win_streak,
    max_loss_streak = excluded.max_loss_streak,
    max_drawdown_r = excluded.max_drawdown_r,
    strategy_adherence_rate = excluded.strategy_adherence_rate,
    rule_violation_count = excluded.rule_violation_count,
    outside_session_count = excluded.outside_session_count,
    risk_violation_count = excluded.risk_violation_count,
    approved_trade_count = excluded.approved_trade_count,
    rejected_or_no_trade_count = excluded.rejected_or_no_trade_count,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.refresh_marketplace_release_verified_metrics(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refresh_marketplace_release_verified_metrics(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
