-- Permission Profile Management. Profiles own permissions independently of organizational identity.

alter table public.permission_profiles
  drop constraint if exists permission_profiles_organization_id_role_key_key;

create table if not exists public.permission_profile_permissions (
  profile_id uuid not null references public.permission_profiles(id) on delete cascade,
  permission_key text not null references public.staff_permissions(permission_key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(profile_id,permission_key)
);

-- Preserve the effective permissions of profiles created by Organizational Structure v1.
insert into public.permission_profile_permissions(profile_id,permission_key)
select pp.id,rp.permission_key
from public.permission_profiles pp
join public.role_permissions rp on rp.role=pp.role_key
on conflict do nothing;

with profile_seed(name,description,role_key) as (values
  ('Admin','Full administrative access to HQ operations and configuration.','SECURITY_ADMIN'),
  ('Support Manager','Manage support operations, customer context, feedback, and team visibility.','SUPPORT'),
  ('Support Agent','View and work with support tickets and customer context.','SUPPORT'),
  ('Sales Manager','Manage the sales pipeline, customer context, billing summaries, and team visibility.','HEAD_OF_SALES'),
  ('Sales Representative','View and work with the sales pipeline and customer context.','HEAD_OF_SALES'),
  ('Compliance Officer','Manage compliance cases and review security audit activity.','COMPLIANCE_OFFICER'),
  ('Risk Analyst','Review compliance cases, customer context, and security audit activity.','COMPLIANCE_OFFICER'),
  ('Finance','Review billing, sales, and customer account summaries.','TECHNICIAN'),
  ('Read Only','Read-only access to the HQ overview and organization directory.','SUPPORT')
), staff_organizations as (
  select distinct organization_id from public.staff_roles where organization_id is not null
)
insert into public.permission_profiles(organization_id,name,description,role_key,active)
select so.organization_id,ps.name,ps.description,ps.role_key,true
from staff_organizations so cross join profile_seed ps
on conflict(organization_id,name) do update set
  description=excluded.description,role_key=excluded.role_key,active=true,updated_at=now();

-- Seeded profiles have deliberately different bundles even when their legacy workspace route is shared.
with grants(profile_name,permission_key) as (values
  ('Admin','hq.view'),('Admin','customers.view_metadata'),('Admin','customers.suspend'),
  ('Admin','staff.view'),('Admin','staff.manage'),('Admin','organizations.view'),('Admin','organizations.manage'),
  ('Admin','sales.view'),('Admin','sales.manage'),('Admin','compliance.view'),('Admin','compliance.manage'),
  ('Admin','support.view'),('Admin','support.manage'),('Admin','system.health'),('Admin','feedback.view'),
  ('Admin','billing.view'),('Admin','security.audit'),('Admin','feature_flags.manage'),
  ('Support Manager','hq.view'),('Support Manager','customers.view_metadata'),('Support Manager','staff.view'),
  ('Support Manager','support.view'),('Support Manager','support.manage'),('Support Manager','feedback.view'),
  ('Support Agent','hq.view'),('Support Agent','customers.view_metadata'),('Support Agent','support.view'),
  ('Sales Manager','hq.view'),('Sales Manager','customers.view_metadata'),('Sales Manager','staff.view'),
  ('Sales Manager','sales.view'),('Sales Manager','sales.manage'),('Sales Manager','billing.view'),
  ('Sales Representative','hq.view'),('Sales Representative','customers.view_metadata'),('Sales Representative','sales.view'),
  ('Compliance Officer','hq.view'),('Compliance Officer','customers.view_metadata'),('Compliance Officer','compliance.view'),
  ('Compliance Officer','compliance.manage'),('Compliance Officer','security.audit'),
  ('Risk Analyst','hq.view'),('Risk Analyst','customers.view_metadata'),('Risk Analyst','compliance.view'),('Risk Analyst','security.audit'),
  ('Finance','hq.view'),('Finance','customers.view_metadata'),('Finance','sales.view'),('Finance','billing.view'),
  ('Read Only','hq.view'),('Read Only','organizations.view')
)
insert into public.permission_profile_permissions(profile_id,permission_key)
select pp.id,g.permission_key from grants g
join public.permission_profiles pp on pp.name=g.profile_name
on conflict do nothing;

create or replace function public.has_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(
    (select spo.granted from public.staff_permission_overrides spo
     join public.staff_roles sr on sr.user_id=spo.user_id
     where spo.user_id=auth.uid() and spo.permission_key=p_permission and sr.is_active limit 1),
    exists(select 1 from public.staff_roles sr
      join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active
      join public.permission_profile_permissions ppp on ppp.profile_id=pp.id
      where sr.user_id=auth.uid() and sr.is_active and ppp.permission_key=p_permission),false)
$$;

create or replace function public.permission_profile_management_v1()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; org_id uuid;
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
  select jsonb_build_object(
    'profiles',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pp.id,'name',pp.name,'description',pp.description,'roleKey',pp.role_key,'active',pp.active,
      'protected',pp.role_key='OWNER','assignedEmployees',(select count(*) from public.staff_roles sr where sr.permission_profile_id=pp.id and sr.is_active),
      'permissions',coalesce((select jsonb_agg(ppp.permission_key order by ppp.permission_key) from public.permission_profile_permissions ppp where ppp.profile_id=pp.id),'[]'::jsonb)
    ) order by pp.name) from public.permission_profiles pp where pp.organization_id=org_id),'[]'::jsonb),
    'permissions',coalesce((select jsonb_agg(jsonb_build_object('key',sp.permission_key,'description',sp.description,'sensitive',sp.sensitive) order by sp.permission_key) from public.staff_permissions sp),'[]'::jsonb)
  ) into result;
  return result;
end;$$;

create or replace function public.manage_permission_profile_v1(
  p_profile_id uuid,p_name text,p_description text,p_role_key text,p_active boolean,p_permission_keys text[]
) returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; result_id uuid; existing_role text; assigned_count integer;
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
  if org_id is null then raise exception 'Staff organization not found'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'Permission profile name required'; end if;
  if upper(p_role_key) not in ('SECURITY_ADMIN','HEAD_OF_SALES','COMPLIANCE_OFFICER','SUPPORT','TECHNICIAN') then raise exception 'Invalid workspace route'; end if;
  if exists(select 1 from unnest(coalesce(p_permission_keys,array[]::text[])) k where not exists(select 1 from public.staff_permissions sp where sp.permission_key=k)) then raise exception 'Unknown permission supplied'; end if;
  if p_profile_id is not null then
    select role_key,(select count(*) from public.staff_roles sr where sr.permission_profile_id=pp.id and sr.is_active)
      into existing_role,assigned_count from public.permission_profiles pp where pp.id=p_profile_id and pp.organization_id=org_id for update;
    if existing_role is null then raise exception 'Permission profile not found'; end if;
    if existing_role='OWNER' then raise exception 'The Owner permission profile is protected'; end if;
    if not p_active and assigned_count>0 then raise exception 'Reassign employees before archiving this permission profile'; end if;
  end if;
  insert into public.permission_profiles(id,organization_id,name,description,role_key,active)
  values(coalesce(p_profile_id,gen_random_uuid()),org_id,trim(p_name),nullif(trim(p_description),''),upper(p_role_key),p_active)
  on conflict(id) do update set name=excluded.name,description=excluded.description,role_key=excluded.role_key,active=excluded.active,updated_at=now()
  returning id into result_id;
  delete from public.permission_profile_permissions where profile_id=result_id;
  insert into public.permission_profile_permissions(profile_id,permission_key)
    select result_id,k from unnest(coalesce(p_permission_keys,array[]::text[])) k on conflict do nothing;
  insert into public.admin_access_logs(staff_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),'MANAGE_PERMISSION_PROFILE','PERMISSION_PROFILE',result_id::text,true,
      jsonb_build_object('name',trim(p_name),'active',p_active,'permission_count',cardinality(coalesce(p_permission_keys,array[]::text[]))));
  return result_id;
end;$$;

alter table public.permission_profile_permissions enable row level security;
revoke all on public.permission_profile_permissions from anon,authenticated;
revoke all on function public.permission_profile_management_v1(),public.manage_permission_profile_v1(uuid,text,text,text,boolean,text[]) from public;
grant execute on function public.permission_profile_management_v1(),public.manage_permission_profile_v1(uuid,text,text,text,boolean,text[]) to authenticated;
