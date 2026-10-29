-- Twelve Data enforces a moving minute budget. Mirror the provider's last
-- 60 seconds instead of resetting optimistically at each UTC minute boundary.
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

  perform pg_advisory_xact_lock(hashtextextended('provider-credit:' || lower(p_provider), 0));

  select coalesce(sum(credits),0)::integer into v_minute_used
    from public.provider_credit_events
    where provider=lower(p_provider)
      and allowed is true
      and created_at > v_now - interval '60 seconds';
  select coalesce(sum(credits),0)::integer into v_day_used
    from public.provider_credit_events
    where provider=lower(p_provider)
      and allowed is true
      and created_at >= v_day;

  -- Display/background candles may use only two rolling credits. Six remain
  -- available for a five-layer live analysis plus its current-price request.
  v_minute_ceiling := case when p_priority='BACKGROUND' then greatest(0,p_minute_limit-6) else p_minute_limit end;
  v_day_ceiling := case when p_priority='BACKGROUND' then greatest(0,p_daily_limit-40) else p_daily_limit end;
  v_allowed := v_minute_used + p_credits <= v_minute_ceiling and v_day_used + p_credits <= v_day_ceiling;

  if v_allowed then
    v_minute_used := v_minute_used + p_credits;
    v_day_used := v_day_used + p_credits;
    v_reason := 'RESERVED';
    v_retry := 0;
  elsif v_day_used + p_credits > v_day_ceiling then
    v_reason := case when p_priority='BACKGROUND' then 'LIVE_DAILY_RESERVE' else 'DAILY_LIMIT' end;
    v_retry := greatest(1,extract(epoch from (v_day + interval '1 day' - v_now))::integer);
  else
    v_reason := case when p_priority='BACKGROUND' then 'LIVE_MINUTE_RESERVE' else 'MINUTE_LIMIT' end;
    v_retry := 61;
  end if;

  insert into public.provider_credit_events(provider,request_key,operation,priority,credits,allowed,reason,minute_window_start,day_window_start)
    values(lower(p_provider),nullif(p_request_key,''),p_operation,p_priority,p_credits,v_allowed,v_reason,v_minute,v_day);

  insert into public.provider_credit_windows(provider,window_kind,window_start,credits_used,updated_at)
    values(lower(p_provider),'MINUTE',v_minute,v_minute_used,v_now),(lower(p_provider),'DAY',v_day,v_day_used,v_now)
    on conflict(provider,window_kind,window_start) do update
      set credits_used=excluded.credits_used,updated_at=excluded.updated_at;
  delete from public.provider_credit_windows where window_start < v_day - interval '2 days';

  return jsonb_build_object('allowed',v_allowed,'reason',v_reason,
    'minuteUsed',v_minute_used,'minuteRemaining',greatest(0,p_minute_limit-v_minute_used),
    'dailyUsed',v_day_used,'dailyRemaining',greatest(0,p_daily_limit-v_day_used),
    'retryAfterSeconds',v_retry,'dailyResetsAt',v_day+interval '1 day');
end;
$$;

revoke all on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer) to service_role;
