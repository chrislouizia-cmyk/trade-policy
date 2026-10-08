-- Recover a backtest invocation that was terminated after acquiring its RUNNING claim.
-- The reserved credit stays attached to the same run; only the execution lease is reset.

create or replace function public.backtest_reclaim_stale_run_atomic(
  p_user_id uuid,
  p_run_id uuid,
  p_stale_after_seconds integer default 360
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.backtest_runs%rowtype;
  v_stale_after_seconds integer;
  v_retry_after_seconds integer;
  v_recovery_count integer;
begin
  v_stale_after_seconds := greatest(60, least(coalesce(p_stale_after_seconds, 360), 3600));

  select *
    into v_run
  from public.backtest_runs br
  where br.id = p_run_id
    and br.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Backtest run was not found for stale lease recovery.';
  end if;

  if v_run.status <> 'RUNNING' then
    return jsonb_build_object(
      'run_id', p_run_id,
      'status', v_run.status,
      'reclaimed', false,
      'reason', 'Run does not hold an active execution lease.'
    );
  end if;

  if v_run.started_at is not null
     and v_run.started_at > now() - make_interval(secs => v_stale_after_seconds) then
    v_retry_after_seconds := greatest(
      1,
      ceil(extract(epoch from (
        v_run.started_at + make_interval(secs => v_stale_after_seconds) - now()
      )))::integer
    );
    return jsonb_build_object(
      'run_id', p_run_id,
      'status', 'RUNNING',
      'reclaimed', false,
      'retry_after_seconds', v_retry_after_seconds
    );
  end if;

  v_recovery_count := case
    when coalesce(v_run.metadata ->> 'recovery_count', '') ~ '^[0-9]+$'
      then (v_run.metadata ->> 'recovery_count')::integer + 1
    else 1
  end;

  update public.backtest_runs
     set status = 'QUEUED',
         started_at = null,
         completed_at = null,
         failure_reason = null,
         updated_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'recovery_count', v_recovery_count,
           'last_recovered_at', now(),
           'last_recovery_reason', 'STALE_EXECUTION_LEASE'
         )
   where id = p_run_id
     and user_id = p_user_id
     and status = 'RUNNING';

  if not found then
    raise exception 'Backtest stale lease recovery lost its RUNNING claim.';
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', 'QUEUED',
    'reclaimed', true,
    'recovery_count', v_recovery_count,
    'credit_status', 'RESERVED'
  );
end;
$$;

revoke all on function public.backtest_reclaim_stale_run_atomic(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.backtest_reclaim_stale_run_atomic(uuid, uuid, integer)
  to service_role;

notify pgrst, 'reload schema';
