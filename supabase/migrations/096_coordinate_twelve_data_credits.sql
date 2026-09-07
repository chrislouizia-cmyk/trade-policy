-- One provider budget shared by every Vercel instance. All timestamps and the
-- Basic-plan daily reset use UTC, matching Twelve Data's credit windows.
create table if not exists public.provider_credit_windows (
  provider text not null,
  window_kind text not null check (window_kind in ('MINUTE','DAY')),
  window_start timestamptz not null,
  credits_used integer not null default 0 check (credits_used >= 0),
  updated_at timestamptz not null default now(),
  primary key (provider, window_kind, window_start)
);

create table if not exists public.provider_credit_events (
  id bigint generated always as identity primary key,
  provider text not null,
  request_key text,
  operation text not null,
  priority text not null check (priority in ('LIVE','INTERACTIVE','BACKGROUND')),
  credits integer not null check (credits > 0),
  allowed boolean not null,
  reason text not null,
  minute_window_start timestamptz not null,
  day_window_start timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists provider_credit_events_recent_idx
  on public.provider_credit_events(provider, created_at desc);

alter table public.provider_credit_windows enable row level security;
alter table public.provider_credit_events enable row level security;
revoke all on public.provider_credit_windows from public, anon, authenticated;
revoke all on public.provider_credit_events from public, anon, authenticated;
grant all on public.provider_credit_windows to service_role;
grant all on public.provider_credit_events to service_role;
grant usage, select on sequence public.provider_credit_events_id_seq to service_role;

create or replace function public.reserve_provider_credits(
  p_provider text,
  p_request_key text,
  p_operation text,
  p_priority text,
  p_credits integer,
  p_minute_limit integer default 8,
  p_daily_limit integer default 800
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day timestamptz := date_trunc('day', v_now);
  v_minute_used integer;
  v_day_used integer;
  v_minute_ceiling integer;
  v_day_ceiling integer;
  v_allowed boolean;
  v_reason text;
  v_retry integer;
begin
  if p_provider is null or length(trim(p_provider)) not between 1 and 40
     or p_operation is null or length(trim(p_operation)) not between 1 and 80
     or p_priority not in ('LIVE','INTERACTIVE','BACKGROUND')
     or p_credits not between 1 and p_minute_limit
     or p_minute_limit < 1 or p_daily_limit < p_minute_limit then
    raise exception 'Invalid provider credit reservation';
  end if;

  -- Serializes reservations across every serverless process for this provider.
  perform pg_advisory_xact_lock(hashtextextended('provider-credit:' || lower(p_provider), 0));

  insert into public.provider_credit_windows(provider,window_kind,window_start)
    values(lower(p_provider),'MINUTE',v_minute),(lower(p_provider),'DAY',v_day)
    on conflict do nothing;
  select credits_used into v_minute_used from public.provider_credit_windows
    where provider=lower(p_provider) and window_kind='MINUTE' and window_start=v_minute for update;
  select credits_used into v_day_used from public.provider_credit_windows
    where provider=lower(p_provider) and window_kind='DAY' and window_start=v_day for update;

  -- Background acquisition cannot take the last two minute credits or the
  -- final 40 daily credits; those remain available for customer decisions.
  v_minute_ceiling := case when p_priority='BACKGROUND' then greatest(0,p_minute_limit-2) else p_minute_limit end;
  v_day_ceiling := case when p_priority='BACKGROUND' then greatest(0,p_daily_limit-40) else p_daily_limit end;
  v_allowed := v_minute_used + p_credits <= v_minute_ceiling and v_day_used + p_credits <= v_day_ceiling;
  if v_allowed then
    update public.provider_credit_windows set credits_used=credits_used+p_credits,updated_at=v_now
      where provider=lower(p_provider) and window_kind='MINUTE' and window_start=v_minute;
    update public.provider_credit_windows set credits_used=credits_used+p_credits,updated_at=v_now
      where provider=lower(p_provider) and window_kind='DAY' and window_start=v_day;
    v_minute_used := v_minute_used + p_credits; v_day_used := v_day_used + p_credits;
    v_reason := 'RESERVED'; v_retry := 0;
  elsif v_day_used + p_credits > v_day_ceiling then
    v_reason := case when p_priority='BACKGROUND' then 'LIVE_DAILY_RESERVE' else 'DAILY_LIMIT' end;
    v_retry := greatest(1,extract(epoch from (v_day + interval '1 day' - v_now))::integer);
  else
    v_reason := case when p_priority='BACKGROUND' then 'LIVE_MINUTE_RESERVE' else 'MINUTE_LIMIT' end;
    v_retry := greatest(1,extract(epoch from (v_minute + interval '1 minute' - v_now))::integer);
  end if;

  insert into public.provider_credit_events(provider,request_key,operation,priority,credits,allowed,reason,minute_window_start,day_window_start)
    values(lower(p_provider),nullif(p_request_key,''),p_operation,p_priority,p_credits,v_allowed,v_reason,v_minute,v_day);
  delete from public.provider_credit_windows where window_start < v_day - interval '2 days';

  return jsonb_build_object('allowed',v_allowed,'reason',v_reason,
    'minuteUsed',v_minute_used,'minuteRemaining',greatest(0,p_minute_limit-v_minute_used),
    'dailyUsed',v_day_used,'dailyRemaining',greatest(0,p_daily_limit-v_day_used),
    'retryAfterSeconds',v_retry,'dailyResetsAt',v_day+interval '1 day');
end;
$$;

revoke all on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer) to service_role;
