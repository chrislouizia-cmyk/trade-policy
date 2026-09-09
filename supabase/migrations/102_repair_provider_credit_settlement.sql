-- provider_credit_events.id is a bigint identity. Migration 101 accidentally
-- selected it into a uuid variable, so successful provider requests failed
-- while settling their credit reservation and their results were discarded.
create or replace function public.settle_provider_credits(
  p_provider text,
  p_request_key text,
  p_actual_credits integer,
  p_provider_credits_used integer default null,
  p_provider_credits_left integer default null,
  p_provider_request_credits integer default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_request_key is null or p_actual_credits < 0 then
    raise exception 'Invalid provider credit settlement';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('provider-credit:' || lower(p_provider), 0));

  select id
    into v_id
    from public.provider_credit_events
   where provider = lower(p_provider)
     and request_key = p_request_key
     and allowed
     and settlement_status = 'PENDING'
   order by created_at desc
   limit 1
   for update;

  if v_id is null then
    return;
  end if;

  update public.provider_credit_events
     set actual_credits = p_actual_credits,
         settlement_status = case when p_actual_credits = 0 then 'RELEASED' else 'CONSUMED' end,
         settled_at = clock_timestamp(),
         provider_credits_used = p_provider_credits_used,
         provider_credits_left = p_provider_credits_left,
         provider_request_credits = p_provider_request_credits
   where id = v_id;
end;
$$;

revoke all on function public.settle_provider_credits(text,text,integer,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.settle_provider_credits(text,text,integer,integer,integer,integer)
  to service_role;
