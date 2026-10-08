-- Turn provider reservations into a two-phase ledger. Pending reservations
-- protect concurrent requests; settlement records what the provider actually used.
alter table public.provider_credit_events add column if not exists settlement_status text;
alter table public.provider_credit_events add column if not exists actual_credits integer;
alter table public.provider_credit_events add column if not exists provider_credits_used integer;
alter table public.provider_credit_events add column if not exists provider_credits_left integer;
alter table public.provider_credit_events add column if not exists provider_request_credits integer;
alter table public.provider_credit_events add column if not exists settled_at timestamptz;

update public.provider_credit_events set settlement_status=case when allowed then 'CONSUMED' else 'REJECTED' end,
  actual_credits=case when allowed then credits else 0 end,settled_at=coalesce(settled_at,created_at)
where settlement_status is null;
alter table public.provider_credit_events alter column settlement_status set default 'PENDING';
alter table public.provider_credit_events alter column settlement_status set not null;
alter table public.provider_credit_events add constraint provider_credit_events_settlement_check check(settlement_status in('PENDING','CONSUMED','RELEASED','REJECTED'));
alter table public.provider_credit_events add constraint provider_credit_events_actual_check check(actual_credits is null or actual_credits>=0);

create or replace function public.settle_provider_credits(p_provider text,p_request_key text,p_actual_credits integer,
  p_provider_credits_used integer default null,p_provider_credits_left integer default null,p_provider_request_credits integer default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if p_request_key is null or p_actual_credits<0 then raise exception 'Invalid provider credit settlement'; end if;
  perform pg_advisory_xact_lock(hashtextextended('provider-credit:'||lower(p_provider),0));
  select id into v_id from public.provider_credit_events where provider=lower(p_provider) and request_key=p_request_key and allowed and settlement_status='PENDING' order by created_at desc limit 1 for update;
  if v_id is null then return; end if;
  update public.provider_credit_events set actual_credits=p_actual_credits,
    settlement_status=case when p_actual_credits=0 then 'RELEASED' else 'CONSUMED' end,settled_at=clock_timestamp(),
    provider_credits_used=p_provider_credits_used,provider_credits_left=p_provider_credits_left,provider_request_credits=p_provider_request_credits where id=v_id;
end;$$;
revoke all on function public.settle_provider_credits(text,text,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.settle_provider_credits(text,text,integer,integer,integer,integer) to service_role;

-- Rebuild reservation accounting around settled usage plus only fresh pending work.
create or replace function public.reserve_provider_credits(p_provider text,p_request_key text,p_operation text,p_priority text,p_credits integer,p_minute_limit integer default 8,p_daily_limit integer default 800) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=clock_timestamp();v_minute timestamptz:=date_trunc('minute',v_now);v_day timestamptz:=date_trunc('day',v_now);v_minute_used integer;v_day_used integer;v_minute_ceiling integer;v_day_ceiling integer;v_allowed boolean;v_reason text;v_retry integer;
begin
 if p_provider is null or p_operation is null or p_priority not in('LIVE','INTERACTIVE','BACKGROUND') or p_credits not between 1 and p_minute_limit then raise exception 'Invalid provider credit reservation';end if;
 perform pg_advisory_xact_lock(hashtextextended('provider-credit:'||lower(p_provider),0));
 select coalesce(sum(case when settlement_status='CONSUMED' then actual_credits else credits end),0)::integer into v_minute_used from public.provider_credit_events where provider=lower(p_provider) and allowed and (settlement_status='CONSUMED' or(settlement_status='PENDING' and created_at>v_now-interval '2 minutes')) and created_at>v_now-interval '60 seconds';
 select coalesce(sum(case when settlement_status='CONSUMED' then actual_credits else credits end),0)::integer into v_day_used from public.provider_credit_events where provider=lower(p_provider) and allowed and (settlement_status='CONSUMED' or(settlement_status='PENDING' and created_at>v_now-interval '2 minutes')) and created_at>=v_day;
 v_minute_ceiling:=case when p_priority='BACKGROUND' then greatest(0,p_minute_limit-7) else p_minute_limit end;v_day_ceiling:=case when p_priority='BACKGROUND' then greatest(0,p_daily_limit-720) else p_daily_limit end;
 v_allowed:=v_minute_used+p_credits<=v_minute_ceiling and v_day_used+p_credits<=v_day_ceiling;
 if v_allowed then v_minute_used:=v_minute_used+p_credits;v_day_used:=v_day_used+p_credits;v_reason:='RESERVED';v_retry:=0;elsif v_day_used+p_credits>v_day_ceiling then v_reason:=case when p_priority='BACKGROUND' then 'LIVE_DAILY_RESERVE' else 'DAILY_LIMIT' end;v_retry:=greatest(1,extract(epoch from(v_day+interval '1 day'-v_now))::integer);else v_reason:=case when p_priority='BACKGROUND' then 'LIVE_MINUTE_RESERVE' else 'MINUTE_LIMIT' end;v_retry:=61;end if;
 insert into public.provider_credit_events(provider,request_key,operation,priority,credits,allowed,reason,minute_window_start,day_window_start,settlement_status,actual_credits,settled_at) values(lower(p_provider),nullif(p_request_key,''),p_operation,p_priority,p_credits,v_allowed,v_reason,v_minute,v_day,case when v_allowed then 'PENDING' else 'REJECTED' end,case when v_allowed then null else 0 end,case when v_allowed then null else v_now end);
 insert into public.provider_credit_windows(provider,window_kind,window_start,credits_used,updated_at) values(lower(p_provider),'MINUTE',v_minute,v_minute_used,v_now),(lower(p_provider),'DAY',v_day,v_day_used,v_now) on conflict(provider,window_kind,window_start) do update set credits_used=excluded.credits_used,updated_at=excluded.updated_at;
 return jsonb_build_object('allowed',v_allowed,'reason',v_reason,'minuteUsed',v_minute_used,'minuteRemaining',greatest(0,p_minute_limit-v_minute_used),'dailyUsed',v_day_used,'dailyRemaining',greatest(0,p_daily_limit-v_day_used),'retryAfterSeconds',v_retry,'dailyResetsAt',v_day+interval '1 day');
end;$$;
revoke all on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.reserve_provider_credits(text,text,text,text,integer,integer,integer) to service_role;
