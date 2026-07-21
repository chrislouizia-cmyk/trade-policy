-- Safe permanent deletion for organizational departments.

alter table public.staff_invitations
  add column if not exists department_id uuid references public.org_departments(id) on delete restrict;

update public.staff_invitations si set department_id=d.id
from public.org_departments d
where si.department_id is null
  and d.organization_id=si.organization_id
  and lower(d.name)=lower(trim(si.department));

create index if not exists staff_invitations_department_idx
  on public.staff_invitations(department_id,status,expires_at);

create or replace function public.department_deletion_eligibility_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare org_id uuid; result jsonb;
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'departmentId',x.id,'eligible',x.employee_count=0 and x.position_count=0 and not x.has_head and x.pending_invitation_count=0,
    'employeeCount',x.employee_count,'positionCount',x.position_count,'hasDepartmentHead',x.has_head,
    'pendingInvitationCount',x.pending_invitation_count,
    'blockers',to_jsonb(array_remove(array[
      case when x.employee_count>0 then x.employee_count||' '||case when x.employee_count=1 then 'employee is' else 'employees are' end||' assigned' end,
      case when x.position_count>0 then x.position_count||' '||case when x.position_count=1 then 'position exists' else 'positions exist' end end,
      case when x.has_head then 'a department head is assigned' end,
      case when x.pending_invitation_count>0 then x.pending_invitation_count||' pending '||case when x.pending_invitation_count=1 then 'invitation references' else 'invitations reference' end||' this department' end
    ],null))
  ) order by x.name),'[]'::jsonb) into result
  from (
    select d.id,d.name,
      (select count(*) from public.staff_roles sr where sr.department_id=d.id) employee_count,
      (select count(*) from public.org_positions p where p.department_id=d.id) position_count,
      d.department_head_employee_id is not null has_head,
      (select count(*) from public.staff_invitations si where si.department_id=d.id and si.status in ('INVITED','PENDING') and (si.expires_at is null or si.expires_at>now())) pending_invitation_count
    from public.org_departments d where d.organization_id=org_id
  ) x;
  return result;
end;$$;

create or replace function public.delete_department_permanently_v1(
  p_department_id uuid,p_confirmation_name text,p_reason text default null
) returns void language plpgsql security definer set search_path=public as $$
declare org_id uuid; department_name text; caller_role text; caller_profile text;
  employee_count integer; position_count integer; pending_invitation_count integer; head_id uuid;
begin
  select sr.organization_id,pp.role_key,pp.name into org_id,caller_role,caller_profile
  from public.staff_roles sr join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active
  where sr.user_id=auth.uid() and sr.is_active;
  if org_id is null or not public.has_staff_permission('staff.manage')
    or not (caller_role='OWNER' or caller_role='SECURITY_ADMIN' or caller_profile='Admin') then
    raise exception 'Only the Owner or an authorized Admin can permanently delete departments';
  end if;

  select name,department_head_employee_id into department_name,head_id
  from public.org_departments where id=p_department_id and organization_id=org_id for update;
  if department_name is null then raise exception 'Department not found'; end if;
  if p_confirmation_name is distinct from department_name then raise exception 'Type the exact department name to confirm deletion'; end if;

  select count(*) into employee_count from public.staff_roles where department_id=p_department_id;
  select count(*) into position_count from public.org_positions where department_id=p_department_id;
  select count(*) into pending_invitation_count from public.staff_invitations
    where department_id=p_department_id and status in ('INVITED','PENDING') and (expires_at is null or expires_at>now());
  if employee_count>0 or position_count>0 or head_id is not null or pending_invitation_count>0 then
    raise exception 'Cannot delete department: % employee(s), % position(s), department head %, % pending invitation(s)',
      employee_count,position_count,case when head_id is null then 'not assigned' else 'assigned' end,pending_invitation_count;
  end if;

  insert into public.admin_access_logs(staff_user_id,action,resource_type,resource_id,success,metadata,created_at)
  values(auth.uid(),'DELETE_DEPARTMENT_PERMANENTLY','DEPARTMENT',p_department_id::text,true,
    jsonb_build_object('department_id',p_department_id,'department_name',department_name,'actor',auth.uid(),
      'deleted_at',now(),'deletion_reason',nullif(trim(p_reason),'')),now());

  begin
    delete from public.org_departments where id=p_department_id and organization_id=org_id;
  exception when foreign_key_violation then
    raise exception 'Cannot delete department: other dependent organizational records exist';
  end;
  if not found then raise exception 'Department could not be deleted'; end if;
end;$$;

revoke all on function public.department_deletion_eligibility_v1(),public.delete_department_permanently_v1(uuid,text,text) from public;
grant execute on function public.department_deletion_eligibility_v1(),public.delete_department_permanently_v1(uuid,text,text) to authenticated;
