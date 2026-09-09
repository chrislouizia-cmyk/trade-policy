-- Close the two remaining trust gaps in the market-data path:
-- 1. verified marketplace metrics are server-owned and inaccessible to clients;
-- 2. a repeated provider request key returns the original reservation instead
--    of reserving provider capacity a second time.

alter table public.marketplace_release_verified_metrics enable row level security;
alter table public.marketplace_release_verified_metrics force row level security;
revoke all on table public.marketplace_release_verified_metrics from public, anon, authenticated;
grant select, insert, update, delete on table public.marketplace_release_verified_metrics to service_role;

alter table public.analysis_usage
  add column if not exists result_analysis_id uuid references public.market_scans(id) on delete set null;

create index if not exists analysis_usage_result_analysis_idx
  on public.analysis_usage(result_analysis_id)
  where result_analysis_id is not null;

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
  v_existing public.provider_credit_events%rowtype;
begin
  if p_provider is null or length(trim(p_provider)) not between 1 and 40
     or p_operation is null or length(trim(p_operation)) not between 1 and 80
     or p_priority not in ('LIVE','INTERACTIVE','BACKGROUND')
     or p_credits not between 1 and p_minute_limit
     or p_minute_limit < 1 or p_daily_limit < p_minute_limit then
    raise exception 'Invalid provider credit reservation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('provider-credit:' || lower(p_provider), 0));

  if nullif(trim(p_request_key), '') is not null then
    select * into v_existing
      from public.provider_credit_events
     where provider = lower(p_provider)
       and request_key = p_request_key
       and (settlement_status = 'CONSUMED'
         or (settlement_status = 'PENDING' and created_at > v_now - interval '2 minutes'))
     order by created_at desc, id desc
     limit 1;

    if found then
      return jsonb_build_object(
        'allowed', v_existing.allowed,
        'reason', v_existing.reason,
        'minuteUsed', 0,
        'minuteRemaining', p_minute_limit,
        'dailyUsed', 0,
        'dailyRemaining', p_daily_limit,
        'retryAfterSeconds', case when v_existing.allowed then 0 else 61 end,
        'dailyResetsAt', v_day + interval '1 day',
        'duplicate', true,
        'settlementStatus', v_existing.settlement_status
      );
    end if;
  end if;

  select coalesce(sum(case when settlement_status='CONSUMED' then actual_credits else credits end),0)::integer
    into v_minute_used
    from public.provider_credit_events
   where provider=lower(p_provider)
     and allowed
     and (settlement_status='CONSUMED' or (settlement_status='PENDING' and created_at>v_now-interval '2 minutes'))
     and created_at>v_now-interval '60 seconds';

  select coalesce(sum(case when settlement_status='CONSUMED' then actual_credits else credits end),0)::integer
    into v_day_used
    from public.provider_credit_events
   where provider=lower(p_provider)
     and allowed
     and (settlement_status='CONSUMED' or (settlement_status='PENDING' and created_at>v_now-interval '2 minutes'))
     and created_at>=v_day;

  v_minute_ceiling := case when p_priority='BACKGROUND' then greatest(0,p_minute_limit-7) else p_minute_limit end;
  v_day_ceiling := case when p_priority='BACKGROUND' then greatest(0,p_daily_limit-720) else p_daily_limit end;
  v_allowed := v_minute_used+p_credits<=v_minute_ceiling and v_day_used+p_credits<=v_day_ceiling;

  if v_allowed then
    v_minute_used := v_minute_used+p_credits;
    v_day_used := v_day_used+p_credits;
    v_reason := 'RESERVED';
    v_retry := 0;
  elsif v_day_used+p_credits>v_day_ceiling then
    v_reason := case when p_priority='BACKGROUND' then 'LIVE_DAILY_RESERVE' else 'DAILY_LIMIT' end;
    v_retry := greatest(1,extract(epoch from(v_day+interval '1 day'-v_now))::integer);
  else
    v_reason := case when p_priority='BACKGROUND' then 'LIVE_MINUTE_RESERVE' else 'MINUTE_LIMIT' end;
    v_retry := 61;
  end if;

  insert into public.provider_credit_events(
    provider,request_key,operation,priority,credits,allowed,reason,
    minute_window_start,day_window_start,settlement_status,actual_credits,settled_at
  ) values (
    lower(p_provider),nullif(trim(p_request_key),''),p_operation,p_priority,p_credits,v_allowed,v_reason,
    v_minute,v_day,case when v_allowed then 'PENDING' else 'REJECTED' end,
    case when v_allowed then null else 0 end,case when v_allowed then null else v_now end
  );

  insert into public.provider_credit_windows(provider,window_kind,window_start,credits_used,updated_at)
    values(lower(p_provider),'MINUTE',v_minute,v_minute_used,v_now),(lower(p_provider),'DAY',v_day,v_day_used,v_now)
    on conflict(provider,window_kind,window_start) do update
      set credits_used=excluded.credits_used,updated_at=excluded.updated_at;

  return jsonb_build_object(
    'allowed',v_allowed,'reason',v_reason,
    'minuteUsed',v_minute_used,'minuteRemaining',greatest(0,p_minute_limit-v_minute_used),
    'dailyUsed',v_day_used,'dailyRemaining',greatest(0,p_daily_limit-v_day_used),
    'retryAfterSeconds',v_retry,'dailyResetsAt',v_day+interval '1 day',
    'duplicate',false,'settlementStatus',case when v_allowed then 'PENDING' else 'REJECTED' end
  );
end;
$$;

revoke all on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer)
  to service_role;

notify pgrst, 'reload schema';
