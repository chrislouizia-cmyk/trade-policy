-- Persist bounded simulation progress without consuming or releasing the reserved credit.
-- Only the service role may move a claimed run back to QUEUED for continuation.

create or replace function public.backtest_checkpoint_run_atomic(
  p_user_id uuid,
  p_run_id uuid,
  p_checkpoint jsonb,
  p_progress_percent numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.backtest_runs%rowtype;
  v_progress numeric;
begin
  if p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object' then
    raise exception 'Backtest checkpoint must be a JSON object.';
  end if;

  v_progress := greatest(0, least(coalesce(p_progress_percent, 0), 99.99));

  select *
    into v_run
  from public.backtest_runs br
  where br.id = p_run_id
    and br.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Backtest run was not found for checkpointing.';
  end if;

  if v_run.status <> 'RUNNING' then
    raise exception 'Backtest run cannot checkpoint from status %.', v_run.status;
  end if;

  if not exists (
    select 1
    from public.backtest_credit_reservations reservation
    where reservation.run_id = p_run_id
      and reservation.user_id = p_user_id
      and reservation.status = 'RESERVED'
  ) then
    raise exception 'Backtest checkpoint requires one RESERVED credit reservation.';
  end if;

  update public.backtest_runs
     set status = 'QUEUED',
         started_at = null,
         updated_at = now(),
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'execution_checkpoint', p_checkpoint,
           'execution_progress_percent', v_progress,
           'last_checkpoint_at', now()
         )
   where id = p_run_id
     and user_id = p_user_id
     and status = 'RUNNING';

  if not found then
    raise exception 'Backtest checkpoint lost its RUNNING claim.';
  end if;

  return jsonb_build_object(
    'run_id', p_run_id,
    'status', 'QUEUED',
    'checkpointed', true,
    'progress_percent', v_progress,
    'credit_status', 'RESERVED'
  );
end;
$$;

revoke all on function public.backtest_checkpoint_run_atomic(uuid, uuid, jsonb, numeric)
  from public, anon, authenticated;
grant execute on function public.backtest_checkpoint_run_atomic(uuid, uuid, jsonb, numeric)
  to service_role;

notify pgrst, 'reload schema';
