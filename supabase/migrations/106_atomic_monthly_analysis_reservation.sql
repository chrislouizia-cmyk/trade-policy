-- Make monthly analysis quota reservation atomic and idempotent.
-- The quota check and reservation happen inside one PostgreSQL transaction,
-- serialized per user + anchored billing period.

create or replace function public.reserve_analysis_usage_atomic(
  p_user_id uuid,
  p_request_key text,
  p_period_start date,
  p_monthly_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.analysis_usage%rowtype;
  v_created public.analysis_usage%rowtype;
  v_used integer := 0;
begin
  if p_user_id is null then
    raise exception 'User is required';
  end if;

  if nullif(btrim(p_request_key), '') is null then
    raise exception 'Request key is required';
  end if;

  if p_period_start is null then
    raise exception 'Billing period is required';
  end if;

  if p_monthly_limit is not null and p_monthly_limit < 0 then
    raise exception 'Monthly analysis limit must be non-negative or null';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'analysis-usage:' || p_user_id::text || ':' || p_period_start::text,
      0
    )
  );

  select *
    into v_existing
    from public.analysis_usage
   where user_id = p_user_id
     and request_key = p_request_key
   limit 1;

  if found then
    return jsonb_build_object(
      'allowed', v_existing.status <> 'FAILED',
      'duplicate', true,
      'reservation', jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'result_analysis_id', v_existing.result_analysis_id
      )
    );
  end if;

  if p_monthly_limit is not null then
    select count(*)::integer
      into v_used
      from public.analysis_usage
     where user_id = p_user_id
       and period_start = p_period_start
       and status in ('RESERVED', 'COMPLETED');

    if v_used >= p_monthly_limit then
      insert into public.analysis_usage(
        user_id,
        request_key,
        period_start,
        status,
        completed_at
      )
      values(
        p_user_id,
        p_request_key,
        p_period_start,
        'FAILED',
        now()
      )
      returning * into v_created;

      return jsonb_build_object(
        'allowed', false,
        'duplicate', false,
        'reservation', jsonb_build_object(
          'id', v_created.id,
          'status', v_created.status,
          'result_analysis_id', v_created.result_analysis_id
        )
      );
    end if;
  end if;

  insert into public.analysis_usage(
    user_id,
    request_key,
    period_start,
    status
  )
  values(
    p_user_id,
    p_request_key,
    p_period_start,
    'RESERVED'
  )
  returning * into v_created;

  return jsonb_build_object(
    'allowed', true,
    'duplicate', false,
    'reservation', jsonb_build_object(
      'id', v_created.id,
      'status', v_created.status,
      'result_analysis_id', v_created.result_analysis_id
    )
  );
end;
$$;

revoke all on function public.reserve_analysis_usage_atomic(uuid, text, date, integer)
  from public, anon, authenticated;

grant execute on function public.reserve_analysis_usage_atomic(uuid, text, date, integer)
  to service_role;

notify pgrst, 'reload schema';
