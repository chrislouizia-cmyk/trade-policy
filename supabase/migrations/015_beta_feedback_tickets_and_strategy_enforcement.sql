-- Trade Police v18: beta feedback tickets + strategy enforcement support.

alter table public.beta_feedback add column if not exists title text;
alter table public.beta_feedback add column if not exists priority text not null default 'NORMAL';
alter table public.beta_feedback add column if not exists assigned_staff_user_id uuid references auth.users(id) on delete set null;
alter table public.beta_feedback add column if not exists resolution_note text;
alter table public.beta_feedback add column if not exists updated_at timestamptz not null default now();
alter table public.beta_feedback add column if not exists resolved_at timestamptz;

do $$ begin
  alter table public.beta_feedback add constraint beta_feedback_priority_check
    check (priority in ('LOW','NORMAL','HIGH','URGENT'));
exception when duplicate_object then null; end $$;

create index if not exists beta_feedback_queue_idx
  on public.beta_feedback(status, priority, created_at desc);

create or replace function public.staff_feedback_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public.current_staff_role();
  result jsonb;
begin
  if r is null or r not in ('OWNER','SUPPORT','HEAD_OF_SALES','TECHNICIAN','SECURITY_ADMIN','COMPLIANCE_OFFICER') then
    raise exception 'Staff access required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'customer_user_id', f.user_id,
    'customer_name', coalesce(p.display_name, 'Beta tester'),
    'customer_email', coalesce(p.email, ''),
    'title', coalesce(nullif(f.title,''), case f.feedback_type when 'ISSUE' then 'Reported issue' when 'FEATURE' then 'Feature request' else 'Beta feedback' end),
    'type', f.feedback_type,
    'message', f.message,
    'page_path', f.page_path,
    'browser', f.browser,
    'ease_score', f.ease_score,
    'priority', f.priority,
    'status', f.status,
    'assigned_staff_user_id', f.assigned_staff_user_id,
    'resolution_note', f.resolution_note,
    'created_at', f.created_at,
    'updated_at', f.updated_at
  ) order by
    case f.priority when 'URGENT' then 1 when 'HIGH' then 2 when 'NORMAL' then 3 else 4 end,
    f.created_at desc), '[]'::jsonb)
  into result
  from public.beta_feedback f
  left join public.profiles p on p.id = f.user_id
  where f.status <> 'CLOSED';

  return result;
end;
$$;

create or replace function public.update_feedback_ticket(
  p_ticket_id uuid,
  p_status text default null,
  p_priority text default null,
  p_resolution_note text default null,
  p_assign_to_me boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public.current_staff_role();
  row_data public.beta_feedback%rowtype;
begin
  if r is null or r not in ('OWNER','SUPPORT','HEAD_OF_SALES','TECHNICIAN','SECURITY_ADMIN','COMPLIANCE_OFFICER') then
    raise exception 'Staff access required';
  end if;
  if p_status is not null and p_status not in ('OPEN','REVIEWING','RESOLVED','CLOSED') then raise exception 'Invalid status'; end if;
  if p_priority is not null and p_priority not in ('LOW','NORMAL','HIGH','URGENT') then raise exception 'Invalid priority'; end if;

  update public.beta_feedback
  set status = coalesce(p_status, status),
      priority = coalesce(p_priority, priority),
      resolution_note = coalesce(p_resolution_note, resolution_note),
      assigned_staff_user_id = case when p_assign_to_me then auth.uid() else assigned_staff_user_id end,
      resolved_at = case when coalesce(p_status,status) in ('RESOLVED','CLOSED') then coalesce(resolved_at, now()) else null end,
      updated_at = now()
  where id = p_ticket_id
  returning * into row_data;
  if not found then raise exception 'Feedback ticket not found'; end if;

  return jsonb_build_object('id',row_data.id,'status',row_data.status,'priority',row_data.priority);
end;
$$;

grant execute on function public.staff_feedback_queue() to authenticated;
grant execute on function public.update_feedback_ticket(uuid,text,text,text,boolean) to authenticated;
