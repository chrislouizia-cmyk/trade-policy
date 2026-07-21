-- Reliable employee invitations with visible lifecycle and normalized organization references.

alter table public.staff_invitations drop constraint if exists staff_invitations_status_check;
update public.staff_invitations set status=case status when 'INVITED' then 'PENDING' when 'CANCELLED' then 'REVOKED' else status end;
alter table public.staff_invitations add constraint staff_invitations_status_check
  check(status in ('PENDING','ACCEPTED','EXPIRED','DELIVERY_FAILED','REVOKED'));
alter table public.staff_invitations drop constraint if exists staff_invitations_user_id_fkey;
alter table public.staff_invitations add constraint staff_invitations_user_id_fkey
  foreign key(user_id) references auth.users(id) on delete set null;
alter table public.staff_invitations add column if not exists position_id uuid references public.org_positions(id) on delete restrict;
alter table public.staff_invitations add column if not exists permission_profile_id uuid references public.permission_profiles(id) on delete restrict;
alter table public.staff_invitations add column if not exists reports_to_employee_id uuid references auth.users(id) on delete set null;
alter table public.staff_invitations add column if not exists delivery_provider text;
alter table public.staff_invitations add column if not exists delivery_attempted_at timestamptz;
alter table public.staff_invitations add column if not exists delivery_error text;
alter table public.staff_invitations add column if not exists provider_message_id text;
alter table public.staff_invitations add column if not exists revoked_at timestamptz;

update public.staff_invitations si set
  position_id=coalesce(si.position_id,sr.position_id),permission_profile_id=coalesce(si.permission_profile_id,sr.permission_profile_id),
  reports_to_employee_id=coalesce(si.reports_to_employee_id,sr.reports_to_employee_id)
from public.staff_roles sr where sr.user_id=si.user_id;

create index if not exists staff_invitations_org_status_idx on public.staff_invitations(organization_id,status,invited_at desc);

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
      'deliveryProvider',si.delivery_provider,'deliveryAttemptedAt',si.delivery_attempted_at,
      'deliveryConfirmed',false,'deliveryError',si.delivery_error
    ) order by si.invited_at desc) filter(where si.id is not null),'[]'::jsonb)
  ) into result
  from public.staff_invitations si
  left join public.org_departments d on d.id=si.department_id left join public.org_positions p on p.id=si.position_id
  left join public.permission_profiles pp on pp.id=si.permission_profile_id
  left join auth.users mu on mu.id=si.reports_to_employee_id left join public.staff_invitations mi on mi.user_id=mu.id
  left join auth.users iu on iu.id=si.invited_by left join public.staff_invitations ii on ii.user_id=iu.id
  where si.organization_id=org_id and si.status in ('PENDING','DELIVERY_FAILED','REVOKED','EXPIRED');
  return result;
end;$$;

revoke all on function public.staff_invitation_workspace_v1() from public;
grant execute on function public.staff_invitation_workspace_v1() to authenticated;
