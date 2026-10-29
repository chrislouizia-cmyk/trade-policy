-- Applied to Trade Police production through the Supabase migration API.
alter table public.trader_intelligence_profiles
  add column if not exists last_material_event_at timestamptz,
  add column if not exists last_intraday_refresh_at timestamptz,
  add column if not exists learning_state jsonb not null default '{}'::jsonb;

alter table public.trader_intelligence_events
  add column if not exists dedupe_key text;

alter table public.trader_intelligence_events
  drop constraint if exists trader_intelligence_events_event_type_check;
alter table public.trader_intelligence_events
  add constraint trader_intelligence_events_event_type_check check (event_type in (
    'ACCOUNT_SEEN','PAGE_VIEW','DECISION_STARTED','DECISION_CREATED',
    'VERDICT_OVERRIDDEN','TRADE_OPENED','TRADE_REANALYZED','TRADE_CLOSED',
    'INTERVENTION_PRESENTED','INTERVENTION_RESPONDED','RECOMMENDATION_EVALUATED',
    'FEEDBACK_SAVED','BACKTEST_COMPLETED'
  ));

alter table public.trader_intelligence_events
  drop constraint if exists trader_intelligence_events_dedupe_key_check;
alter table public.trader_intelligence_events
  add constraint trader_intelligence_events_dedupe_key_check
  check (dedupe_key is null or char_length(dedupe_key) = 64);

create unique index if not exists trader_intelligence_events_dedupe_idx
  on public.trader_intelligence_events(user_id,event_type,dedupe_key);
create index if not exists trader_intelligence_events_type_time_idx
  on public.trader_intelligence_events(user_id,event_type,occurred_at desc);

alter table public.trader_intelligence_recommendations
  add column if not exists evaluation_window integer not null default 5
    check (evaluation_window between 5 and 100);

alter table public.trader_intelligence_interventions
  add column if not exists response text
    check (response is null or response in ('ACKNOWLEDGED','DISMISSED','HELPFUL','NOT_HELPFUL')),
  add column if not exists response_note text
    check (response_note is null or char_length(response_note) <= 280),
  add column if not exists responded_at timestamptz;

alter table public.trader_intelligence_contributions
  drop constraint if exists trader_intelligence_contributions_dimension_check;
alter table public.trader_intelligence_contributions
  add constraint trader_intelligence_contributions_dimension_check check (
    dimension in ('hour','weekday','instrument','session','discipline','direction','trade_number','after_outcome')
  );

alter table public.trader_collective_patterns
  drop constraint if exists trader_collective_patterns_dimension_check;
alter table public.trader_collective_patterns
  add constraint trader_collective_patterns_dimension_check check (
    dimension in ('hour','weekday','instrument','session','discipline','direction','trade_number','after_outcome')
  );

comment on column public.trader_intelligence_events.dedupe_key is
  'Server-generated SHA-256 idempotency key. Raw identifiers are never stored here.';
comment on column public.trader_intelligence_profiles.learning_state is
  'Compact server-owned intraday learning state; never an authorization input.';
