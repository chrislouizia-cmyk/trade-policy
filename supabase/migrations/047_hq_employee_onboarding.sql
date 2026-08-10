-- Complete staff invitations through an authenticated, auditable onboarding transition.

alter table public.staff_invitations drop constraint if exists staff_invitations_status_check;
alter table public.staff_invitations add constraint staff_invitations_status_check
  check(status in ('PENDING','ACCEPTED','EXPIRED','DELIVERY_FAILED','PERSISTENCE_FAILED','REVOKED'));

grant select on table public.staff_invitations to service_role;

-- Preserve staff who completed the legacy invite flow before acceptance tracking existed.
update public.staff_invitations si
set status='ACCEPTED',accepted_at=coalesce(si.accepted_at,u.email_confirmed_at,u.last_sign_in_at,now()),updated_at=now()
from auth.users u
where u.id=si.user_id and si.status='PENDING' and (u.email_confirmed_at is not null or u.last_sign_in_at is not null);

update public.organization_members om
set status='ACTIVE'
from public.staff_invitations si
where si.user_id=om.user_id and si.organization_id=om.organization_id and si.status='ACCEPTED' and om.membership_type='STAFF';

create or replace function public.current_staff_invitation_onboarding_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select jsonb_build_object('invitationId',si.id,'name',si.display_name,'email',si.email,'role',pp.role_key,'status',si.status)
  into result
  from public.staff_invitations si
  join public.staff_roles sr on sr.user_id=si.user_id and sr.is_active
  join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active
  where si.user_id=auth.uid() and si.status='PENDING' and (si.expires_at is null or si.expires_at>now())
  order by si.invited_at desc limit 1;
  return result;
end;$$;

create or replace function public.accept_staff_invitation_v1()
returns jsonb language plpgsql security definer set search_path=public as $$
declare invitation public.staff_invitations%rowtype; target_route text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into invitation from public.staff_invitations where user_id=auth.uid() order by invited_at desc limit 1 for update;
  if invitation.id is null then raise exception 'Staff invitation not found'; end if;
  if invitation.status='ACCEPTED' then
    select case sr.role when 'OWNER' then '/hq' when 'HEAD_OF_SALES' then '/hq/sales' when 'COMPLIANCE_OFFICER' then '/hq/compliance' when 'SUPPORT' then '/hq/support' when 'TECHNICIAN' then '/hq/system' when 'SECURITY_ADMIN' then '/hq/compliance' else '/hq' end into target_route from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
    return jsonb_build_object('status','ACCEPTED','route',coalesce(target_route,'/hq'));
  end if;
  if invitation.status<>'PENDING' then raise exception 'Staff invitation is not eligible for acceptance'; end if;
  if invitation.expires_at is not null and invitation.expires_at<=now() then raise exception 'Staff invitation has expired'; end if;
  if not exists(select 1 from public.staff_roles where user_id=auth.uid() and is_active) then raise exception 'Active staff role not found'; end if;
  update public.staff_invitations set status='ACCEPTED',accepted_at=coalesce(accepted_at,now()),delivery_error=null,updated_at=now() where id=invitation.id;
  update public.organization_members set status='ACTIVE' where organization_id=invitation.organization_id and user_id=auth.uid() and membership_type='STAFF';
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),auth.uid(),'ACCEPT_STAFF_INVITATION','STAFF_INVITATION',invitation.id::text,true,jsonb_build_object('organization_id',invitation.organization_id));
  select case sr.role when 'OWNER' then '/hq' when 'HEAD_OF_SALES' then '/hq/sales' when 'COMPLIANCE_OFFICER' then '/hq/compliance' when 'SUPPORT' then '/hq/support' when 'TECHNICIAN' then '/hq/system' when 'SECURITY_ADMIN' then '/hq/compliance' else '/hq' end into target_route from public.staff_roles sr where sr.user_id=auth.uid() and sr.is_active;
  return jsonb_build_object('status','ACCEPTED','route',coalesce(target_route,'/hq'));
end;$$;

create or replace function public.has_staff_permission(p_permission text) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select spo.granted from public.staff_permission_overrides spo join public.staff_roles sr on sr.user_id=spo.user_id where spo.user_id=auth.uid() and spo.permission_key=p_permission and sr.is_active and not exists(select 1 from public.staff_invitations si where si.user_id=sr.user_id and si.status<>'ACCEPTED') limit 1),
    exists(select 1 from public.staff_roles sr join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active join public.role_permissions rp on rp.role=pp.role_key where sr.user_id=auth.uid() and sr.is_active and rp.permission_key=p_permission and not exists(select 1 from public.staff_invitations si where si.user_id=sr.user_id and si.status<>'ACCEPTED')),false)
$$;

create or replace function public.current_staff_role() returns text language sql stable security definer set search_path=public as $$
  select pp.role_key from public.staff_roles sr join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active
  where sr.user_id=auth.uid() and sr.is_active and not exists(select 1 from public.staff_invitations si where si.user_id=sr.user_id and si.status<>'ACCEPTED') limit 1
$$;

create or replace function public.staff_workspace_route()
returns text language plpgsql stable security definer set search_path=public as $$
declare r text;
begin
  r:=public.current_staff_role(); if r is null then return null; end if;
  return case r when 'OWNER' then '/hq' when 'HEAD_OF_SALES' then '/hq/sales' when 'COMPLIANCE_OFFICER' then '/hq/compliance' when 'SUPPORT' then '/hq/support' when 'TECHNICIAN' then '/hq/system' when 'SECURITY_ADMIN' then '/hq/compliance' else null end;
end;$$;

create or replace function public.resend_staff_invitation_prepare_v1(p_invitation_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare caller_org uuid; invitation public.staff_invitations%rowtype; auth_user auth.users%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select organization_id into caller_org from public.staff_roles where user_id=auth.uid() and is_active;
  select * into invitation from public.staff_invitations where id=p_invitation_id and organization_id=caller_org for update;
  if invitation.id is null then raise exception 'Invitation not found'; end if;
  if invitation.status not in('PENDING','DELIVERY_FAILED','PERSISTENCE_FAILED','EXPIRED') then raise exception 'Invitation is not eligible for resend'; end if;
  if invitation.user_id is null then raise exception 'Pending Auth identity is unavailable; revoke and invite again'; end if;
  select * into auth_user from auth.users where id=invitation.user_id;
  if auth_user.id is null or auth_user.email_confirmed_at is not null or auth_user.last_sign_in_at is not null then raise exception 'Invitation is not eligible for resend'; end if;
  return jsonb_build_object('id',invitation.id,'userId',invitation.user_id,'email',invitation.email,'displayName',invitation.display_name,
    'departmentId',invitation.department_id,'positionId',invitation.position_id,'permissionProfileId',invitation.permission_profile_id,'reportsToEmployeeId',invitation.reports_to_employee_id);
end;$$;

create or replace function public.mark_staff_invitation_persistence_failed_v1(
  p_invitation_id uuid,p_auth_user_id uuid,p_display_name text,p_email text,p_department_id uuid,p_position_id uuid,
  p_permission_profile_id uuid,p_reports_to_employee_id uuid,p_expires_at timestamptz,p_delivery_provider text,
  p_error_category text,p_error_message text,p_request_id uuid,p_auth_cleanup_succeeded boolean default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; caller_org uuid;
begin
  result:=public.mark_staff_invitation_delivery_failed_v1(p_invitation_id,p_auth_user_id,p_display_name,p_email,p_department_id,p_position_id,p_permission_profile_id,p_reports_to_employee_id,p_expires_at,p_delivery_provider,p_error_category,p_error_message,p_request_id,p_auth_cleanup_succeeded);
  select organization_id into caller_org from public.staff_roles where user_id=auth.uid() and is_active;
  update public.staff_invitations set status='PERSISTENCE_FAILED',updated_at=now() where id=p_invitation_id and organization_id=caller_org;
  return result||jsonb_build_object('status','PERSISTENCE_FAILED');
end;$$;

create or replace function public.staff_invitation_workspace_v1()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare org_id uuid; result jsonb;
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
  select jsonb_build_object(
    'pendingCount',(select count(*) from public.staff_invitations where organization_id=org_id and status='PENDING' and (expires_at is null or expires_at>now())),
    'invitations',coalesce(jsonb_agg(jsonb_build_object(
      'id',si.id,'userId',si.user_id,'name',si.display_name,'email',si.email,'department',d.name,'position',p.title,
      'permissionProfile',pp.name,'manager',coalesce(mi.display_name,mu.raw_user_meta_data->>'display_name',mu.email),
      'status',case when si.status='PENDING' and si.expires_at<now() then 'EXPIRED' else si.status end,
      'createdAt',si.invited_at,'expiresAt',si.expires_at,'invitedBy',coalesce(ii.display_name,iu.raw_user_meta_data->>'display_name',iu.email),
      'deliveryProvider',si.delivery_provider,'deliveryAttemptedAt',si.delivery_attempted_at,'deliveryConfirmed',false,'deliveryError',si.delivery_error
    ) order by si.invited_at desc) filter(where si.id is not null),'[]'::jsonb)
  ) into result
  from public.staff_invitations si
  left join public.org_departments d on d.id=si.department_id left join public.org_positions p on p.id=si.position_id
  left join public.permission_profiles pp on pp.id=si.permission_profile_id
  left join auth.users mu on mu.id=si.reports_to_employee_id left join public.staff_invitations mi on mi.user_id=mu.id
  left join auth.users iu on iu.id=si.invited_by left join public.staff_invitations ii on ii.user_id=iu.id
  where si.organization_id=org_id and si.status in ('PENDING','DELIVERY_FAILED','PERSISTENCE_FAILED','REVOKED','EXPIRED');
  return result;
end;$$;

revoke all on function public.current_staff_invitation_onboarding_v1(),public.accept_staff_invitation_v1(),public.mark_staff_invitation_persistence_failed_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid,boolean) from public,anon;
grant execute on function public.current_staff_invitation_onboarding_v1(),public.accept_staff_invitation_v1(),public.mark_staff_invitation_persistence_failed_v1(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text,text,text,uuid,boolean) to authenticated;

notify pgrst,'reload schema';
