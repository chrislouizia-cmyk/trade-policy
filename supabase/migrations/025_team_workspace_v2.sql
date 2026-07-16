-- Trade Police V21 — employee team workspace. Staff identities remain separate from customer profiles.

alter table public.staff_roles add column if not exists department text;
alter table public.staff_roles add column if not exists manager_user_id uuid references auth.users(id) on delete set null;
alter table public.staff_invitations add column if not exists department text;
alter table public.staff_invitations add column if not exists manager_user_id uuid references auth.users(id) on delete set null;
alter table public.staff_invitations add column if not exists expires_at timestamptz;
update public.staff_invitations set expires_at=invited_at+interval '7 days' where expires_at is null;

create index if not exists staff_roles_team_filter_idx on public.staff_roles(role,is_active,department,last_active_at desc);
create index if not exists staff_invitations_pending_idx on public.staff_invitations(status,expires_at,invited_at desc);

create or replace function public.staff_team_workspace_v2(
  p_query text default '', p_page integer default 1, p_page_size integer default 25,
  p_role text default 'ALL', p_department text default 'ALL', p_status text default 'ALL'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  p_page:=greatest(1,p_page); p_page_size:=greatest(1,least(p_page_size,100));
  with staff_base as (
    select sr.user_id,u.email,coalesce(si.display_name,u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name') display_name,
      sr.display_title,sr.role,sr.department,sr.manager_user_id,sr.is_active,sr.mfa_required,sr.last_active_at,sr.created_at,
      coalesce(si.status,case when sr.is_active then 'ACTIVE' else 'DISABLED' end) invitation_status
    from public.staff_roles sr join auth.users u on u.id=sr.user_id left join public.staff_invitations si on si.user_id=sr.user_id
  ), filtered as (
    select *,count(*) over() total_count from staff_base where
      (nullif(trim(p_query),'') is null or concat_ws(' ',display_name,email,display_title,role,department) ilike '%'||trim(p_query)||'%')
      and (upper(p_role)='ALL' or role=upper(p_role))
      and (upper(p_department)='ALL' or coalesce(department,'UNASSIGNED')=p_department)
      and (upper(p_status)='ALL' or (upper(p_status)='ACTIVE' and is_active) or (upper(p_status)='DISABLED' and not is_active) or invitation_status=upper(p_status))
  ), paged as (select * from filtered order by coalesce(last_active_at,created_at) desc,user_id limit p_page_size offset (p_page-1)*p_page_size)
  select jsonb_build_object(
    'summary',jsonb_build_object(
      'employees',(select count(*) from staff_base),
      'pendingInvitations',(select count(*) from public.staff_invitations where status='INVITED' and coalesce(expires_at,now()+interval '1 day')>now()),
      'activeThisWeek',(select count(*) from staff_base where last_active_at>=now()-interval '7 days'),
      'ownersAdmins',(select count(*) from staff_base where role in ('OWNER','SECURITY_ADMIN')),
      'customRoles',(select count(distinct role) from staff_base where role not in ('OWNER','HEAD_OF_SALES','COMPLIANCE_OFFICER','SUPPORT','TECHNICIAN','SECURITY_ADMIN')),
      'disabledAccounts',(select count(*) from staff_base where not is_active)),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'name',display_name,'email',email,'role',role,'title',display_title,'department',department,'sent',invited_at,'expires',expires_at,'status',case when status='INVITED' and expires_at<now() then 'EXPIRED' else status end) order by invited_at desc) from public.staff_invitations where status='INVITED'),'[]'::jsonb),
    'staff',coalesce((select jsonb_agg(to_jsonb(paged)-'total_count') from paged),'[]'::jsonb),
    'total',coalesce((select max(total_count) from paged),0),'page',p_page,'pageSize',p_page_size,
    'departments',coalesce((select jsonb_agg(department order by department) from (select distinct department from staff_base where department is not null) d),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(jsonb_build_object('role',r.role,'users',(select count(*) from staff_base s where s.role=r.role),'permissions',(select count(*) from public.role_permissions rp where rp.role=r.role)) order by r.role) from (select distinct role from public.role_permissions) r),'[]'::jsonb),
    'permissionMatrix',coalesce((select jsonb_agg(jsonb_build_object('key',sp.permission_key,'description',sp.description,'roles',coalesce((select jsonb_agg(rp.role) from public.role_permissions rp where rp.permission_key=sp.permission_key),'[]'::jsonb)) order by sp.permission_key) from public.staff_permissions sp),'[]'::jsonb),
    'activity',coalesce((
      select jsonb_agg(activity_rows.event_payload order by activity_rows.event_created_at desc)
      from (
        select
          jsonb_build_object(
            'who',coalesce(staff_user.email,access_log.staff_user_id::text),
            'action',access_log.action,
            'target',coalesce(access_log.resource_id,access_log.resource_type),
            'result',case when access_log.success then 'SUCCESS' else 'FAILED' end,
            'created_at',access_log.created_at
          ) as event_payload,
          access_log.created_at as event_created_at
        from public.admin_access_logs as access_log
        left join auth.users as staff_user on staff_user.id=access_log.staff_user_id
        where access_log.action in (
          'ASSIGN_STAFF_ROLE','RESTORE_STAFF','SUSPEND_STAFF','SET_STAFF_PERMISSION',
          'INVITE_STAFF','CANCEL_STAFF_INVITATION','RESEND_STAFF_INVITATION'
        )
        order by access_log.created_at desc
        limit 20
      ) as activity_rows
    ),'[]'::jsonb),
    'organization',(select jsonb_build_object('id',o.id,'name',o.name,'status',o.status) from public.organizations o where o.slug='trade-police-hq')
  ) into v_result;
  return v_result;
end;$$;
revoke all on function public.staff_team_workspace_v2(text,integer,integer,text,text,text) from public;
grant execute on function public.staff_team_workspace_v2(text,integer,integer,text,text,text) to authenticated;

create or replace function public.staff_employee_profile_v2(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb;
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  select jsonb_build_object('identity',jsonb_build_object('user_id',sr.user_id,'email',u.email,'name',coalesce(si.display_name,u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name'),'title',sr.display_title,'department',sr.department,'role',sr.role,'active',sr.is_active,'last_active',sr.last_active_at),
    'permissions',coalesce((select jsonb_agg(jsonb_build_object('key',m.permission_key,'description',m.description,'granted',m.granted,'source',m.source)) from public.owner_staff_permission_matrix(p_user_id) m),'[]'::jsonb),
    'assignedCustomers','[]'::jsonb,
    'assignedCases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'summary',c.summary,'status',c.status,'severity',c.severity)) from public.compliance_cases c where c.assigned_to=p_user_id),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(jsonb_build_object('action',l.action,'resource',l.resource_type,'result',l.success,'created_at',l.created_at) order by l.created_at desc) from public.admin_access_logs l where l.staff_user_id=p_user_id),'[]'::jsonb),
    'security',jsonb_build_object('mfa_required',sr.mfa_required,'active',sr.is_active)) into v_result
  from public.staff_roles sr join auth.users u on u.id=sr.user_id left join public.staff_invitations si on si.user_id=sr.user_id where sr.user_id=p_user_id;
  return v_result;
end;$$;
revoke all on function public.staff_employee_profile_v2(uuid) from public;
grant execute on function public.staff_employee_profile_v2(uuid) to authenticated;

notify pgrst, 'reload schema';
