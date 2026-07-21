-- Keep protected organizational tables private and expose only authorized invitation operations.

create or replace function public.check_staff_invitation_duplicate_v1(p_email text)
returns table(id uuid,status text,expires_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare caller_org uuid; normalized_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  if caller_org is null then raise exception 'Active staff organization required'; end if;
  normalized_email:=lower(trim(coalesce(p_email,'')));
  if normalized_email='' then raise exception 'Email is required'; end if;
  return query select si.id,si.status,si.expires_at from public.staff_invitations si
    where si.organization_id=caller_org and lower(si.email)=normalized_email order by si.invited_at desc limit 1;
end;$$;

create or replace function public.prepare_staff_invitation_v1(
  p_email text,p_display_name text,p_department_id uuid,p_position_id uuid,
  p_permission_profile_id uuid,p_reports_to_employee_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; normalized_email text; department_row public.org_departments%rowtype;
  position_row public.org_positions%rowtype; profile_row public.permission_profiles%rowtype;
  existing_invitation public.staff_invitations%rowtype; invitation_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  if caller_org is null then raise exception 'Active staff organization required'; end if;
  normalized_email:=lower(trim(coalesce(p_email,'')));
  if normalized_email='' then raise exception 'Email is required'; end if;
  if nullif(trim(coalesce(p_display_name,'')),'') is null then raise exception 'Employee name is required'; end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;

  select * into department_row from public.org_departments d where d.id=p_department_id and d.organization_id=caller_org;
  if department_row.id is null or not department_row.active then raise exception 'The selected department is inactive or unavailable'; end if;
  select * into position_row from public.org_positions p where p.id=p_position_id and p.organization_id=caller_org;
  if position_row.id is null or not position_row.active then raise exception 'The selected position is inactive or unavailable'; end if;
  if position_row.department_id<>department_row.id then raise exception 'The selected position does not belong to this department'; end if;
  select * into profile_row from public.permission_profiles pp where pp.id=p_permission_profile_id and pp.organization_id=caller_org;
  if profile_row.id is null or not profile_row.active then raise exception 'Permission profile is required and must be active'; end if;
  if profile_row.role_key='OWNER' then raise exception 'The Owner permission profile cannot be assigned by invitation'; end if;
  if p_reports_to_employee_id is not null and not exists(
    select 1 from public.staff_roles manager where manager.user_id=p_reports_to_employee_id
      and manager.organization_id=caller_org and manager.is_active
  ) then raise exception 'The selected manager is inactive or ineligible'; end if;
  if exists(select 1 from auth.users u join public.staff_roles sr on sr.user_id=u.id
    where lower(u.email)=normalized_email and sr.organization_id=caller_org and sr.is_active) then
    raise exception 'This email already belongs to an employee';
  end if;
  select * into existing_invitation from public.staff_invitations si
    where si.organization_id=caller_org and lower(si.email)=normalized_email order by si.invited_at desc limit 1 for update;
  if existing_invitation.id is not null and existing_invitation.status='PENDING'
    and (existing_invitation.expires_at is null or existing_invitation.expires_at>now()) then
    raise exception 'This email already has a pending invitation';
  end if;
  invitation_id:=coalesce(existing_invitation.id,gen_random_uuid());
  return jsonb_build_object('invitationId',invitation_id,'email',normalized_email,
    'displayName',trim(p_display_name),'departmentId',department_row.id,'department',department_row.name,
    'positionId',position_row.id,'position',position_row.title,'permissionProfileId',profile_row.id,
    'permissionProfile',profile_row.name,'roleKey',profile_row.role_key,'reportsToEmployeeId',p_reports_to_employee_id);
end;$$;

create or replace function public.create_staff_invitation_v1(
  p_invitation_id uuid,p_auth_user_id uuid,p_display_name text,p_email text,p_department_id uuid,
  p_position_id uuid,p_permission_profile_id uuid,p_reports_to_employee_id uuid,p_expires_at timestamptz,
  p_delivery_provider text,p_provider_message_id text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; normalized_email text; department_row public.org_departments%rowtype;
  position_row public.org_positions%rowtype; profile_row public.permission_profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  if caller_org is null then raise exception 'Active staff organization required'; end if;
  normalized_email:=lower(trim(coalesce(p_email,'')));
  if p_invitation_id is null or p_auth_user_id is null or p_request_id is null or normalized_email='' then raise exception 'Invitation identity is required'; end if;
  if p_expires_at is null or p_expires_at<=now() then raise exception 'A future expiration is required'; end if;
  if not exists(select 1 from auth.users u where u.id=p_auth_user_id and lower(u.email)=normalized_email) then raise exception 'Auth invitation identity does not match'; end if;
  select * into department_row from public.org_departments d where d.id=p_department_id and d.organization_id=caller_org and d.active;
  if department_row.id is null then raise exception 'The selected department is inactive or unavailable'; end if;
  select * into position_row from public.org_positions p where p.id=p_position_id and p.organization_id=caller_org and p.active;
  if position_row.id is null then raise exception 'The selected position is inactive or unavailable'; end if;
  if position_row.department_id<>department_row.id then raise exception 'The selected position does not belong to this department'; end if;
  select * into profile_row from public.permission_profiles pp where pp.id=p_permission_profile_id and pp.organization_id=caller_org and pp.active;
  if profile_row.id is null then raise exception 'Permission profile is required and must be active'; end if;
  if profile_row.role_key='OWNER' then raise exception 'The Owner permission profile cannot be assigned by invitation'; end if;
  if p_reports_to_employee_id is not null and not exists(select 1 from public.staff_roles manager
    where manager.user_id=p_reports_to_employee_id and manager.organization_id=caller_org and manager.is_active)
    then raise exception 'The selected manager is inactive or ineligible'; end if;
  if exists(select 1 from public.staff_roles sr where sr.organization_id=caller_org and sr.is_active and
    (sr.user_id=p_auth_user_id or exists(select 1 from auth.users u where u.id=sr.user_id and lower(u.email)=normalized_email)))
    then raise exception 'This email already belongs to an employee'; end if;
  if exists(select 1 from public.staff_invitations si where si.organization_id=caller_org and lower(si.email)=normalized_email
    and si.id<>p_invitation_id and si.status='PENDING' and (si.expires_at is null or si.expires_at>now())) then raise exception 'This email already has a pending invitation'; end if;

  insert into public.staff_roles(user_id,role,is_active,organization_id,display_title,invited_by,mfa_required,
    department,department_id,position_id,permission_profile_id,manager_user_id,reports_to_employee_id)
  values(p_auth_user_id,profile_row.role_key,true,caller_org,position_row.title,auth.uid(),true,
    department_row.name,department_row.id,position_row.id,profile_row.id,p_reports_to_employee_id,p_reports_to_employee_id);
  insert into public.organization_members(organization_id,user_id,membership_type,status)
    values(caller_org,p_auth_user_id,'STAFF','INVITED');
  insert into public.staff_invitations(id,user_id,email,display_name,role,display_title,organization_id,invited_by,status,
    invited_at,expires_at,department,department_id,position_id,permission_profile_id,manager_user_id,reports_to_employee_id,
    delivery_provider,delivery_attempted_at,delivery_error,provider_message_id,revoked_at,updated_at)
  values(p_invitation_id,p_auth_user_id,normalized_email,trim(p_display_name),profile_row.role_key,position_row.title,
    caller_org,auth.uid(),'PENDING',now(),p_expires_at,department_row.name,department_row.id,position_row.id,profile_row.id,
    p_reports_to_employee_id,p_reports_to_employee_id,nullif(trim(p_delivery_provider),''),now(),null,
    nullif(trim(p_provider_message_id),''),null,now())
  on conflict(id) do update set user_id=excluded.user_id,display_name=excluded.display_name,role=excluded.role,
    display_title=excluded.display_title,status='PENDING',invited_at=now(),expires_at=excluded.expires_at,
    department=excluded.department,department_id=excluded.department_id,position_id=excluded.position_id,
    permission_profile_id=excluded.permission_profile_id,manager_user_id=excluded.manager_user_id,
    reports_to_employee_id=excluded.reports_to_employee_id,delivery_provider=excluded.delivery_provider,
    delivery_attempted_at=now(),delivery_error=null,provider_message_id=excluded.provider_message_id,revoked_at=null,updated_at=now();
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),p_auth_user_id,'INVITE_STAFF_ATTEMPT','STAFF_INVITATION',p_invitation_id::text,true,
      jsonb_build_object('organization_id',caller_org,'email',normalized_email,'outcome','PENDING','request_id',p_request_id,'provider',p_delivery_provider));
  return jsonb_build_object('id',p_invitation_id,'email',normalized_email,'status','PENDING');
end;$$;

create or replace function public.mark_staff_invitation_delivery_failed_v1(
  p_invitation_id uuid,p_auth_user_id uuid,p_display_name text,p_email text,p_department_id uuid,p_position_id uuid,
  p_permission_profile_id uuid,p_reports_to_employee_id uuid,p_expires_at timestamptz,p_delivery_provider text,
  p_error_category text,p_error_message text,p_request_id uuid,p_auth_cleanup_succeeded boolean default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; normalized_email text; department_name text; position_title text; profile_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  normalized_email:=lower(trim(coalesce(p_email,'')));
  if caller_org is null or p_invitation_id is null or p_request_id is null or normalized_email='' then raise exception 'Invitation failure context is incomplete'; end if;
  select d.name into department_name from public.org_departments d where d.id=p_department_id and d.organization_id=caller_org;
  select p.title into position_title from public.org_positions p where p.id=p_position_id and p.organization_id=caller_org and p.department_id=p_department_id;
  select pp.role_key into profile_role from public.permission_profiles pp where pp.id=p_permission_profile_id and pp.organization_id=caller_org;
  if department_name is null or position_title is null or profile_role is null or profile_role='OWNER' then raise exception 'Invitation failure references are invalid'; end if;
  if p_reports_to_employee_id is not null and not exists(select 1 from public.staff_roles manager
    where manager.user_id=p_reports_to_employee_id and manager.organization_id=caller_org and manager.is_active)
    then raise exception 'Invitation failure manager is invalid'; end if;
  insert into public.staff_invitations(id,user_id,email,display_name,role,display_title,organization_id,invited_by,status,
    invited_at,expires_at,department,department_id,position_id,permission_profile_id,manager_user_id,reports_to_employee_id,
    delivery_provider,delivery_attempted_at,delivery_error,updated_at)
  values(p_invitation_id,p_auth_user_id,normalized_email,trim(p_display_name),profile_role,position_title,caller_org,auth.uid(),
    'DELIVERY_FAILED',now(),p_expires_at,department_name,p_department_id,p_position_id,p_permission_profile_id,
    p_reports_to_employee_id,p_reports_to_employee_id,nullif(trim(p_delivery_provider),''),now(),left(coalesce(p_error_message,'Delivery failed'),1000),now())
  on conflict(email) do update set user_id=excluded.user_id,status='DELIVERY_FAILED',delivery_provider=excluded.delivery_provider,
    delivery_attempted_at=now(),delivery_error=excluded.delivery_error,updated_at=now();
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),p_auth_user_id,'INVITE_STAFF_ATTEMPT','STAFF_INVITATION',p_invitation_id::text,false,
      jsonb_build_object('organization_id',caller_org,'email',normalized_email,'outcome','DELIVERY_FAILED','request_id',p_request_id,
        'error_category',upper(trim(coalesce(p_error_category,'UNKNOWN'))),'auth_cleanup_succeeded',p_auth_cleanup_succeeded));
  return jsonb_build_object('id',p_invitation_id,'email',normalized_email,'status','DELIVERY_FAILED');
end;$$;

create or replace function public.resend_staff_invitation_prepare_v1(p_invitation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; invitation public.staff_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  select * into invitation from public.staff_invitations si where si.id=p_invitation_id and si.organization_id=caller_org for update;
  if invitation.id is null then raise exception 'Invitation not found'; end if;
  if invitation.status in('ACCEPTED','REVOKED') then raise exception 'Invitation is not eligible for resend'; end if;
  return jsonb_build_object('id',invitation.id,'userId',invitation.user_id,'email',invitation.email);
end;$$;

create or replace function public.mark_staff_invitation_resent_v1(p_invitation_id uuid,p_request_id uuid,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; normalized_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  update public.staff_invitations set status='PENDING',delivery_error=null,delivery_attempted_at=now(),invited_at=now(),
    expires_at=p_expires_at,updated_at=now() where id=p_invitation_id and organization_id=caller_org
    and status not in('ACCEPTED','REVOKED') returning email into normalized_email;
  if normalized_email is null then raise exception 'Invitation is not eligible for resend'; end if;
  insert into public.admin_access_logs(staff_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),'RESEND_STAFF_INVITATION','STAFF_INVITATION',p_invitation_id::text,true,
      jsonb_build_object('organization_id',caller_org,'email',normalized_email,'outcome','PENDING','request_id',p_request_id));
  return jsonb_build_object('id',p_invitation_id,'email',normalized_email,'status','PENDING');
end;$$;

create or replace function public.mark_staff_invitation_resend_failed_v1(
  p_invitation_id uuid,p_request_id uuid,p_error_category text,p_error_message text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; normalized_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  update public.staff_invitations set status='DELIVERY_FAILED',delivery_attempted_at=now(),
    delivery_error=left(coalesce(p_error_message,'Delivery failed'),1000),updated_at=now()
    where id=p_invitation_id and organization_id=caller_org and status not in('ACCEPTED','REVOKED') returning email into normalized_email;
  if normalized_email is null then raise exception 'Invitation is not eligible for resend'; end if;
  insert into public.admin_access_logs(staff_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),'RESEND_STAFF_INVITATION','STAFF_INVITATION',p_invitation_id::text,false,
      jsonb_build_object('organization_id',caller_org,'email',normalized_email,'outcome','DELIVERY_FAILED',
        'request_id',p_request_id,'error_category',upper(trim(coalesce(p_error_category,'UNKNOWN')))));
  return jsonb_build_object('id',p_invitation_id,'email',normalized_email,'status','DELIVERY_FAILED');
end;$$;

create or replace function public.revoke_staff_invitation_v1(p_invitation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; invitation public.staff_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select sr.organization_id into caller_org from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  select * into invitation from public.staff_invitations si where si.id=p_invitation_id and si.organization_id=caller_org for update;
  if invitation.id is null then raise exception 'Invitation not found'; end if;
  if invitation.status='ACCEPTED' then raise exception 'Accepted invitations cannot be revoked'; end if;
  if invitation.status='REVOKED' then raise exception 'Invitation is already revoked'; end if;
  update public.staff_invitations set status='REVOKED',revoked_at=now(),updated_at=now() where id=invitation.id;
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),invitation.user_id,'REVOKE_STAFF_INVITATION','STAFF_INVITATION',invitation.id::text,true,
      jsonb_build_object('organization_id',caller_org,'email',invitation.email,'outcome','REVOKED','request_id',p_request_id));
  return jsonb_build_object('id',invitation.id,'userId',invitation.user_id,'email',invitation.email,'status','REVOKED');
end;$$;

revoke all on function public.check_staff_invitation_duplicate_v1(text) from public,anon;
revoke all on function public.prepare_staff_invitation_v1(text,text,uuid,uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.create_staff_invitation_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,uuid) from public,anon;
revoke all on function public.mark_staff_invitation_delivery_failed_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid,boolean) from public,anon;
revoke all on function public.resend_staff_invitation_prepare_v1(uuid,uuid) from public,anon;
revoke all on function public.mark_staff_invitation_resent_v1(uuid,uuid,timestamptz) from public,anon;
revoke all on function public.mark_staff_invitation_resend_failed_v1(uuid,uuid,text,text) from public,anon;
revoke all on function public.revoke_staff_invitation_v1(uuid,uuid) from public,anon;
grant execute on function public.check_staff_invitation_duplicate_v1(text),
  public.prepare_staff_invitation_v1(text,text,uuid,uuid,uuid,uuid,uuid),
  public.create_staff_invitation_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,uuid),
  public.mark_staff_invitation_delivery_failed_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid,boolean),
  public.resend_staff_invitation_prepare_v1(uuid,uuid),public.mark_staff_invitation_resent_v1(uuid,uuid,timestamptz),
  public.mark_staff_invitation_resend_failed_v1(uuid,uuid,text,text),
  public.revoke_staff_invitation_v1(uuid,uuid) to authenticated;

notify pgrst,'reload schema';
