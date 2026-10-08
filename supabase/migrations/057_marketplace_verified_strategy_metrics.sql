create table if not exists public.marketplace_release_verified_metrics (
  id uuid primary key default gen_random_uuid(),
  creator_user_id uuid not null references auth.users(id) on delete restrict,
  creator_display_name text,
  member_since timestamptz,
  total_verified_platform_trades integer default null,
  total_marketplace_strategies integer default null,
  source_strategy_id uuid not null references public.strategy_profiles(id) on delete restrict,
  source_strategy_revision_id text not null,
  marketplace_release_id uuid not null references public.marketplace_strategy_releases(id) on delete restrict,
  observation_started_at timestamptz,
  last_verified_activity_at timestamptz,
  observation_days integer default null,
  metric_status text not null default 'NOT_ENOUGH_VERIFIED_DATA',
  wins integer default null,
  losses integer default null,
  break_even integer default null,
  win_rate numeric default null,
  loss_rate numeric default null,
  total_r numeric default null,
  average_r numeric default null,
  expectancy_r numeric default null,
  profit_factor numeric default null,
  best_trade_r numeric default null,
  worst_trade_r numeric default null,
  max_win_streak integer default null,
  max_loss_streak integer default null,
  max_drawdown_r numeric default null,
  strategy_adherence_rate numeric default null,
  rule_violation_count integer default null,
  outside_session_count integer default null,
  risk_violation_count integer default null,
  approved_trade_count integer default null,
  rejected_or_no_trade_count integer default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_strategy_id, source_strategy_revision_id, marketplace_release_id)
);

create index if not exists marketplace_release_verified_metrics_release_idx
  on public.marketplace_release_verified_metrics(marketplace_release_id, source_strategy_revision_id, created_at desc);

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
  v_has_verified_activity boolean := false;
  v_observation_started_at timestamptz;
  v_last_verified_activity_at timestamptz;
  v_row public.marketplace_release_verified_metrics%rowtype;
begin
  if p_marketplace_release_id is null or p_source_strategy_id is null or nullif(trim(p_source_strategy_revision_id), '') is null then
    raise exception 'Release, strategy, and exact revision are required';
  end if;

  select * into v_release
  from public.marketplace_strategy_releases
  where id = p_marketplace_release_id
  for update;

  if not found then
    raise exception 'Marketplace release not found';
  end if;

  if v_release.source_strategy_id <> p_source_strategy_id or v_release.source_strategy_revision_id <> p_source_strategy_revision_id then
    raise exception 'Release strategy revision mismatch';
  end if;

  select * into v_creator
  from public.profiles
  where id = v_release.creator_user_id
  limit 1;

  v_has_verified_activity := exists (
    select 1
    from public.active_trades at
    where at.marketplace_release_id = p_marketplace_release_id
      and at.strategy_profile_id = p_source_strategy_id
      and coalesce(at.strategy_revision_id, '') = p_source_strategy_revision_id
      and at.status = 'CLOSED'
      and at.closed_at is not null
  ) or exists (
    select 1
    from public.decision_reports dr
    where dr.marketplace_release_id = p_marketplace_release_id
      and dr.strategy_id = p_source_strategy_id
      and coalesce(dr.strategy_revision_id, '') = p_source_strategy_revision_id
      and dr.strategy_revision_id is not null
  ) or exists (
    select 1
    from public.market_scans ms
    where ms.marketplace_release_id = p_marketplace_release_id
      and ms.strategy_profile_id = p_source_strategy_id
      and coalesce(ms.strategy_revision_id, '') = p_source_strategy_revision_id
      and ms.strategy_revision_id is not null
      and ms.created_at is not null
  );

  select min(activity_at), max(activity_at)
    into v_observation_started_at, v_last_verified_activity_at
    from (
      select at.closed_at as activity_at
      from public.active_trades at
      where at.marketplace_release_id = p_marketplace_release_id
        and at.strategy_profile_id = p_source_strategy_id
        and coalesce(at.strategy_revision_id, '') = p_source_strategy_revision_id
        and at.status = 'CLOSED'
        and at.closed_at is not null
      union all
      select dr.created_at as activity_at
      from public.decision_reports dr
      where dr.marketplace_release_id = p_marketplace_release_id
        and dr.strategy_id = p_source_strategy_id
        and coalesce(dr.strategy_revision_id, '') = p_source_strategy_revision_id
        and dr.strategy_revision_id is not null
        and dr.created_at is not null
      union all
      select ms.created_at as activity_at
      from public.market_scans ms
      where ms.marketplace_release_id = p_marketplace_release_id
        and ms.strategy_profile_id = p_source_strategy_id
        and coalesce(ms.strategy_revision_id, '') = p_source_strategy_revision_id
        and ms.strategy_revision_id is not null
        and ms.created_at is not null
    ) valid_activity;

  -- Lifetime creator metrics are intentionally kept separate from exact release/revision metrics.
  -- This is not from public.profiles where creator_user_id = v_release.creator_user_id.
  -- Never aggregate by strategy profile alone. The release and exact revision are the scope.
  with trade_base as (
    select
      at.id,
      at.result_r,
      at.outcome,
      at.strategy_revision_id,
      at.marketplace_release_id,
      at.strategy_profile_id,
      at.closed_at,
      at.created_at
    from public.active_trades at
    where at.marketplace_release_id = p_marketplace_release_id
      and at.strategy_profile_id = p_source_strategy_id
      and coalesce(at.strategy_revision_id, '') = p_source_strategy_revision_id
      and at.status = 'CLOSED'
      and at.closed_at is not null
      and at.result_r is not null
  ),
  decision_base as (
    select
      dr.id,
      dr.verdict,
      dr.strategy_revision_id,
      dr.marketplace_release_id,
      dr.strategy_id,
      dr.created_at
    from public.decision_reports dr
    where dr.marketplace_release_id = p_marketplace_release_id
      and dr.strategy_id = p_source_strategy_id
      and coalesce(dr.strategy_revision_id, '') = p_source_strategy_revision_id
      and dr.strategy_revision_id is not null
  )
  select
    coalesce((select count(*) from trade_base where outcome = 'WIN'), null),
    coalesce((select count(*) from trade_base where outcome = 'LOSS'), null),
    coalesce((select count(*) from trade_base where outcome = 'BREAKEVEN'), null),
    case
      when (coalesce((select count(*) from trade_base where outcome in ('WIN','LOSS','BREAKEVEN')), 0)) > 0 then
        ((select count(*) from trade_base where outcome = 'WIN')::numeric) /
        (select count(*) from trade_base where outcome in ('WIN','LOSS','BREAKEVEN'))
      else null
    end,
    case
      when (coalesce((select count(*) from trade_base where outcome in ('WIN','LOSS','BREAKEVEN')), 0)) > 0 then
        ((select count(*) from trade_base where outcome = 'LOSS')::numeric) /
        (select count(*) from trade_base where outcome in ('WIN','LOSS','BREAKEVEN'))
      else null
    end,
    (select coalesce(sum(result_r), null) from trade_base),
    case
      when (coalesce((select count(*) from trade_base), 0)) > 0 then
        (select coalesce(sum(result_r), 0) from trade_base) / (select count(*) from trade_base)
      else null
    end,
    case
      when (coalesce((select count(*) from trade_base), 0)) > 0 then
        (select coalesce(sum(result_r), 0) from trade_base) / (select count(*) from trade_base)
      else null
    end,
    case
      when (coalesce((select sum(case when result_r > 0 then result_r else 0 end) from trade_base), 0)) > 0 and (coalesce((select abs(sum(case when result_r < 0 then result_r else 0 end)) from trade_base), 0)) > 0 then
        ((select coalesce(sum(case when result_r > 0 then result_r else 0 end), 0) from trade_base)) /
        ((select coalesce(abs(sum(case when result_r < 0 then result_r else 0 end)), 0) from trade_base))
      else null
    end,
    (select max(result_r) from trade_base),
    (select min(result_r) from trade_base),
    (select max(win_streak) from (
      select count(*) as win_streak
      from (
        select result_r, row_number() over (order by coalesce(closed_at, created_at), id) as rn
        from trade_base
        where outcome = 'WIN'
      ) t
      group by rn
    ) s),
    (select max(loss_streak) from (
      select count(*) as loss_streak
      from (
        select result_r, row_number() over (order by coalesce(closed_at, created_at), id) as rn
        from trade_base
        where outcome = 'LOSS'
      ) t
      group by rn
    ) s),
    null,
    null,
    null,
    null,
    null,
    (select count(*) from decision_base where verdict = 'APPROVE'),
    (select count(*) from decision_base where verdict in ('REJECT','NO_TRADE'))
    into v_row.wins, v_row.losses, v_row.break_even,
         v_row.win_rate, v_row.loss_rate, v_row.total_r,
         v_row.average_r, v_row.expectancy_r, v_row.profit_factor,
         v_row.best_trade_r, v_row.worst_trade_r,
         v_row.max_win_streak, v_row.max_loss_streak,
         v_row.max_drawdown_r, v_row.strategy_adherence_rate,
         v_row.rule_violation_count, v_row.outside_session_count,
         v_row.risk_violation_count, v_row.approved_trade_count,
         v_row.rejected_or_no_trade_count;

  v_row.creator_user_id := v_release.creator_user_id;
  v_row.creator_display_name := coalesce(v_creator.display_name, 'Trade Police');
  v_row.member_since := v_creator.created_at;
  v_row.total_verified_platform_trades := (
    select count(*)
    from public.trade_records tr
    where tr.user_id = v_release.creator_user_id
      and tr.outcome is not null
      and tr.created_at is not null
  );
  v_row.total_marketplace_strategies := (
    select count(*)
    from public.marketplace_strategy_releases mr
    where mr.creator_user_id = v_release.creator_user_id
  );
  v_row.source_strategy_id := p_source_strategy_id;
  v_row.source_strategy_revision_id := p_source_strategy_revision_id;
  v_row.marketplace_release_id := p_marketplace_release_id;
  v_row.observation_started_at := v_observation_started_at;
  v_row.last_verified_activity_at := v_last_verified_activity_at;
  v_row.observation_days := case
    when v_observation_started_at is not null and v_last_verified_activity_at is not null then
      floor(extract(epoch from (v_last_verified_activity_at - v_observation_started_at)) / 86400.0)::int
    else null
  end;
  v_row.metric_status := case
    when v_has_verified_activity then 'VERIFIED'
    else 'NOT_ENOUGH_VERIFIED_DATA'
  end;
  v_row.created_at := now();
  v_row.updated_at := now();

  insert into public.marketplace_release_verified_metrics (
    creator_user_id,
    creator_display_name,
    member_since,
    total_verified_platform_trades,
    total_marketplace_strategies,
    source_strategy_id,
    source_strategy_revision_id,
    marketplace_release_id,
    observation_started_at,
    last_verified_activity_at,
    observation_days,
    metric_status,
    wins,
    losses,
    break_even,
    win_rate,
    loss_rate,
    total_r,
    average_r,
    expectancy_r,
    profit_factor,
    best_trade_r,
    worst_trade_r,
    max_win_streak,
    max_loss_streak,
    max_drawdown_r,
    strategy_adherence_rate,
    rule_violation_count,
    outside_session_count,
    risk_violation_count,
    approved_trade_count,
    rejected_or_no_trade_count,
    created_at,
    updated_at
  ) values (
    v_row.creator_user_id,
    v_row.creator_display_name,
    v_row.member_since,
    v_row.total_verified_platform_trades,
    v_row.total_marketplace_strategies,
    v_row.source_strategy_id,
    v_row.source_strategy_revision_id,
    v_row.marketplace_release_id,
    v_row.observation_started_at,
    v_row.last_verified_activity_at,
    v_row.observation_days,
    v_row.metric_status,
    v_row.wins,
    v_row.losses,
    v_row.break_even,
    v_row.win_rate,
    v_row.loss_rate,
    v_row.total_r,
    v_row.average_r,
    v_row.expectancy_r,
    v_row.profit_factor,
    v_row.best_trade_r,
    v_row.worst_trade_r,
    v_row.max_win_streak,
    v_row.max_loss_streak,
    v_row.max_drawdown_r,
    v_row.strategy_adherence_rate,
    v_row.rule_violation_count,
    v_row.outside_session_count,
    v_row.risk_violation_count,
    v_row.approved_trade_count,
    v_row.rejected_or_no_trade_count,
    v_row.created_at,
    v_row.updated_at
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

notify pgrst,'reload schema';
