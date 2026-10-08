-- Safely expose invitation management references to authorized Team managers and
-- reconcile only a missing invitation record for an already-pending staff identity.

create or replace function public.staff_team_workspace_v3(p_query text default '',p_page integer default 1,p_page_size integer default 25,p_department_id text default 'ALL',p_position_id text default 'ALL',p_manager_id text default 'ALL',p_status text default 'ALL')
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; org_id uuid; can_manage boolean;
begin
 if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
 select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
 can_manage:=public.has_staff_permission('staff.manage');
 p_page:=greatest(1,p_page);p_page_size:=greatest(1,least(p_page_size,100));
 with people as (
  select sr.user_id,u.email,coalesce(si.display_name,u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name') display_name,sr.is_active,sr.mfa_required,sr.last_active_at,
   sr.role,pp.id permission_profile_id,pp.name permission_profile,d.id department_id,d.name department,p.id position_id,p.title position,p.management_level,sr.reports_to_employee_id,
   coalesce(mi.display_name,mu.raw_user_meta_data->>'display_name',mu.email) manager_name,(select count(*) from public.staff_roles dr where dr.reports_to_employee_id=sr.user_id and dr.is_active) direct_reports_count,
   coalesce(si.status,case when sr.is_active then 'ACTIVE' else 'DISABLED' end) invitation_status,sr.created_at,
   case when can_manage then si.id else null end invitation_id,
   (can_manage and si.id is null and sr.is_active and u.email_confirmed_at is null and u.last_sign_in_at is null) invitation_recovery_available
  from public.staff_roles sr join auth.users u on u.id=sr.user_id
  left join lateral (select * from public.staff_invitations x where x.organization_id=sr.organization_id and x.user_id=sr.user_id order by x.updated_at desc,x.invited_at desc limit 1) si on true
  left join public.permission_profiles pp on pp.id=sr.permission_profile_id left join public.org_departments d on d.id=sr.department_id left join public.org_positions p on p.id=sr.position_id
  left join auth.users mu on mu.id=sr.reports_to_employee_id left join lateral (select * from public.staff_invitations x where x.organization_id=sr.organization_id and x.user_id=mu.id order by x.updated_at desc,x.invited_at desc limit 1) mi on true where sr.organization_id=org_id
 ), filtered as (
  select *,count(*) over() total_count from people where (nullif(trim(p_query),'') is null or concat_ws(' ',display_name,email,position,department,permission_profile,manager_name) ilike '%'||trim(p_query)||'%')
   and (upper(p_department_id)='ALL' or department_id::text=p_department_id) and (upper(p_position_id)='ALL' or position_id::text=p_position_id)
   and (upper(p_manager_id)='ALL' or reports_to_employee_id::text=p_manager_id or (upper(p_manager_id)='NONE' and reports_to_employee_id is null))
   and (upper(p_status)='ALL' or (upper(p_status)='ACTIVE' and is_active) or (upper(p_status)='DISABLED' and not is_active) or invitation_status=upper(p_status))
 ), paged as (select * from filtered order by coalesce(last_active_at,created_at) desc limit p_page_size offset (p_page-1)*p_page_size)
 select jsonb_build_object(
  'summary',jsonb_build_object('employees',(select count(*) from people),'activeEmployees',(select count(*) from people where is_active),'departments',(select count(*) from public.org_departments where organization_id=org_id and active),'managers',(select count(*) from people where direct_reports_count>0),'disabledAccounts',(select count(*) from people where not is_active)),
  'staff',coalesce((select jsonb_agg(to_jsonb(paged)-'total_count') from paged),'[]'::jsonb),'total',coalesce((select max(total_count) from paged),0),'page',p_page,'pageSize',p_page_size,
  'departments',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,'active',d.active,'headEmployeeId',d.department_head_employee_id,'headName',coalesce(hi.display_name,hu.raw_user_meta_data->>'display_name',hu.email),'employeeCount',(select count(*) from public.staff_roles s where s.department_id=d.id and s.is_active)) order by d.name) from public.org_departments d left join auth.users hu on hu.id=d.department_head_employee_id left join public.staff_invitations hi on hi.user_id=hu.id where d.organization_id=org_id),'[]'::jsonb),
  'positions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'departmentId',p.department_id,'description',p.description,'managementLevel',p.management_level,'active',p.active) order by p.management_level desc,p.title) from public.org_positions p where p.organization_id=org_id),'[]'::jsonb),
  'permissionProfiles',coalesce((select jsonb_agg(jsonb_build_object('id',pp.id,'name',pp.name,'description',pp.description,'roleKey',pp.role_key,'active',pp.active) order by pp.name) from public.permission_profiles pp where pp.organization_id=org_id),'[]'::jsonb),
  'managers',coalesce((select jsonb_agg(jsonb_build_object('id',x.user_id,'name',x.display_name,'position',x.position,'department',x.department,'departmentId',x.department_id,'managementLevel',x.management_level,'role',x.role,'isDepartmentHead',exists(select 1 from public.org_departments dh where dh.department_head_employee_id=x.user_id)) order by x.is_active desc,x.management_level desc,x.display_name) from people x where x.is_active),'[]'::jsonb),
  'orgChart',coalesce((select jsonb_agg(jsonb_build_object('id',x.user_id,'name',x.display_name,'position',x.position,'department',x.department,'reportsTo',x.reports_to_employee_id,'directReports',x.direct_reports_count) order by x.management_level desc,x.display_name) from people x where x.is_active),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('who',coalesce(au.email,l.staff_user_id::text),'action',l.action,'target',coalesce(l.resource_id,l.resource_type),'result',case when l.success then 'SUCCESS' else 'FAILED' end,'created_at',l.created_at) order by l.created_at desc) from public.admin_access_logs l left join auth.users au on au.id=l.staff_user_id where l.action in('CHANGE_EMPLOYEE_MANAGER','REASSIGN_MANAGER_REPORTS','MANAGE_DEPARTMENT','MANAGE_POSITION','SUSPEND_STAFF','RESTORE_STAFF','RECONCILE_STAFF_INVITATION','RESEND_STAFF_INVITATION') and l.created_at>now()-interval '90 days'),'[]'::jsonb)
 ) into result; return result;
end;$$;

create or replace function public.reconcile_staff_invitation_v1(p_employee_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; target public.staff_roles%rowtype; target_user auth.users%rowtype; invitation public.staff_invitations%rowtype;
  department_row public.org_departments%rowtype; position_row public.org_positions%rowtype; profile_row public.permission_profiles%rowtype; invitation_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
 if p_employee_id is null or p_request_id is null then raise exception 'Employee and request identifiers are required'; end if;
 select organization_id into caller_org from public.staff_roles where user_id=auth.uid() and is_active;
 if caller_org is null then raise exception 'Active staff organization required'; end if;
 select * into target from public.staff_roles where user_id=p_employee_id and organization_id=caller_org for update;
 if target.user_id is null then raise exception 'Employee not found'; end if;
 if not target.is_active then raise exception 'Disabled employees cannot receive an invitation'; end if;
 select * into target_user from auth.users where id=target.user_id;
 if target_user.id is null then raise exception 'Employee Auth identity is unavailable'; end if;
 select * into invitation from public.staff_invitations si where si.organization_id=caller_org and (si.user_id=target.user_id or lower(si.email)=lower(target_user.email)) order by si.updated_at desc,si.invited_at desc limit 1 for update;
 if invitation.id is not null then return jsonb_build_object('id',invitation.id,'status',invitation.status,'reconciled',false); end if;
 if target_user.email_confirmed_at is not null or target_user.last_sign_in_at is not null then raise exception 'An invitation cannot be recovered after account acceptance or sign-in'; end if;
 select * into department_row from public.org_departments where id=target.department_id and organization_id=caller_org and active;
 select * into position_row from public.org_positions where id=target.position_id and organization_id=caller_org and active;
 select * into profile_row from public.permission_profiles where id=target.permission_profile_id and organization_id=caller_org and active;
 if department_row.id is null or position_row.id is null or position_row.department_id<>department_row.id or profile_row.id is null or profile_row.role_key='OWNER' then raise exception 'Employee organization configuration cannot be safely reconciled'; end if;
 if target.reports_to_employee_id is not null and not exists(select 1 from public.staff_roles manager where manager.user_id=target.reports_to_employee_id and manager.organization_id=caller_org and manager.is_active) then raise exception 'Employee reporting line cannot be safely reconciled'; end if;
 invitation_id:=gen_random_uuid();
 insert into public.staff_invitations(id,user_id,email,display_name,role,display_title,organization_id,invited_by,status,invited_at,expires_at,department,department_id,position_id,permission_profile_id,manager_user_id,reports_to_employee_id,delivery_provider,delivery_attempted_at,delivery_error,updated_at)
 values(invitation_id,target.user_id,lower(target_user.email),coalesce(target_user.raw_user_meta_data->>'display_name',target_user.raw_user_meta_data->>'full_name',target_user.email),profile_row.role_key,position_row.title,caller_org,auth.uid(),'PERSISTENCE_FAILED',now(),now(),department_row.name,department_row.id,position_row.id,profile_row.id,target.reports_to_employee_id,target.reports_to_employee_id,'SUPABASE_AUTH',now(),'Recovered missing invitation record; resend required.',now());
 insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
 values(auth.uid(),target.user_id,'RECONCILE_STAFF_INVITATION','STAFF_INVITATION',invitation_id::text,true,jsonb_build_object('organization_id',caller_org,'request_id',p_request_id,'outcome','PERSISTENCE_FAILED'));
 return jsonb_build_object('id',invitation_id,'status','PERSISTENCE_FAILED','reconciled',true);
end;$$;

revoke all on function public.reconcile_staff_invitation_v1(uuid,uuid) from public,anon;
grant execute on function public.reconcile_staff_invitation_v1(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
