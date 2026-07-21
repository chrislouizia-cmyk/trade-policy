-- Organizational Structure v1. Organization identity is independent from permission profiles.

create table if not exists public.permission_profiles (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, description text, role_key text not null, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name), unique(organization_id,role_key)
);
create table if not exists public.org_departments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, description text, active boolean not null default true, department_head_employee_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,name)
);
create table if not exists public.org_positions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  department_id uuid not null references public.org_departments(id) on delete restrict, title text not null, description text,
  management_level integer not null default 0 check(management_level between 0 and 20), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(department_id,title)
);

alter table public.staff_roles add column if not exists department_id uuid references public.org_departments(id) on delete restrict;
alter table public.staff_roles add column if not exists position_id uuid references public.org_positions(id) on delete restrict;
alter table public.staff_roles add column if not exists permission_profile_id uuid references public.permission_profiles(id) on delete restrict;
alter table public.staff_roles add column if not exists reports_to_employee_id uuid references auth.users(id) on delete restrict;

update public.staff_roles sr set organization_id=o.id from public.organizations o
where sr.organization_id is null and o.slug='trade-police-hq';
do $$ begin
  if exists(select 1 from public.staff_roles where is_active and organization_id is null) then
    raise exception 'Active legacy staff must belong to the existing Trade Police organization before Organizational Structure v1 can be applied';
  end if;
end $$;

insert into public.permission_profiles(organization_id,name,description,role_key)
select o.id,initcap(replace(r.role,'_',' ')),r.role||' permission profile',r.role
from public.organizations o cross join (select distinct role from public.staff_roles) r
on conflict(organization_id,role_key) do nothing;
update public.staff_roles sr set permission_profile_id=pp.id from public.permission_profiles pp
where pp.organization_id=sr.organization_id and pp.role_key=sr.role and sr.permission_profile_id is null;
do $$ begin
  if exists(select 1 from public.staff_roles where is_active and permission_profile_id is null) then
    raise exception 'Permission-profile backfill did not cover every active employee';
  end if;
end $$;
insert into public.role_permissions(role,permission_key) values('SECURITY_ADMIN','staff.manage') on conflict do nothing;

insert into public.org_departments(organization_id,name)
select distinct sr.organization_id,trim(sr.department) from public.staff_roles sr
where sr.organization_id is not null and nullif(trim(sr.department),'') is not null on conflict(organization_id,name) do nothing;
update public.staff_roles sr set department_id=d.id from public.org_departments d
where d.organization_id=sr.organization_id and d.name=trim(sr.department) and sr.department_id is null;
insert into public.org_positions(organization_id,department_id,title,management_level)
select distinct sr.organization_id,sr.department_id,coalesce(nullif(trim(sr.display_title),''),initcap(replace(sr.role,'_',' '))),case when sr.role in('OWNER','SECURITY_ADMIN','HEAD_OF_SALES') then 10 else 0 end
from public.staff_roles sr where sr.organization_id is not null and sr.department_id is not null
on conflict(department_id,title) do nothing;
update public.staff_roles sr set position_id=p.id from public.org_positions p
where p.department_id=sr.department_id and p.title=coalesce(nullif(trim(sr.display_title),''),initcap(replace(sr.role,'_',' '))) and sr.position_id is null;
update public.staff_roles set reports_to_employee_id=manager_user_id where reports_to_employee_id is null and manager_user_id is not null;

create or replace function public.validate_employee_manager() returns trigger language plpgsql set search_path=public as $$
declare cycle_found boolean;
begin
  if new.reports_to_employee_id is null then return new; end if;
  if new.reports_to_employee_id=new.user_id then raise exception 'Employees cannot report to themselves'; end if;
  if not exists(select 1 from public.staff_roles m where m.user_id=new.reports_to_employee_id and m.is_active and m.organization_id=new.organization_id) then raise exception 'Reports To must reference an active employee in the organization'; end if;
  with recursive managers(user_id,reports_to_employee_id) as (
    select s.user_id,s.reports_to_employee_id from public.staff_roles s where s.user_id=new.reports_to_employee_id
    union all select s.user_id,s.reports_to_employee_id from public.staff_roles s join managers m on s.user_id=m.reports_to_employee_id
  ) select exists(select 1 from managers where user_id=new.user_id) into cycle_found;
  if cycle_found then raise exception 'Reporting relationship would create a cycle'; end if;
  return new;
end;$$;
drop trigger if exists validate_employee_manager_trigger on public.staff_roles;
create trigger validate_employee_manager_trigger before insert or update of reports_to_employee_id,organization_id on public.staff_roles for each row execute function public.validate_employee_manager();

create or replace function public.has_staff_permission(p_permission text) returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select spo.granted from public.staff_permission_overrides spo join public.staff_roles sr on sr.user_id=spo.user_id where spo.user_id=auth.uid() and spo.permission_key=p_permission and sr.is_active limit 1),
    exists(select 1 from public.staff_roles sr join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active join public.role_permissions rp on rp.role=pp.role_key where sr.user_id=auth.uid() and sr.is_active and rp.permission_key=p_permission),false)
$$;
create or replace function public.current_staff_role() returns text language sql stable security definer set search_path=public as $$
  select pp.role_key from public.staff_roles sr join public.permission_profiles pp on pp.id=sr.permission_profile_id and pp.active where sr.user_id=auth.uid() and sr.is_active limit 1
$$;

create or replace function public.manage_employee_organization(p_employee_id uuid,p_department_id uuid,p_position_id uuid,p_permission_profile_id uuid,p_reports_to_employee_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare old_manager uuid; target_org uuid; profile_role text;
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select organization_id,reports_to_employee_id into target_org,old_manager from public.staff_roles where user_id=p_employee_id for update;
  if target_org is null then raise exception 'Employee not found'; end if;
  if p_department_id is not null and not exists(select 1 from public.org_departments where id=p_department_id and organization_id=target_org and active) then raise exception 'Active department required'; end if;
  if p_position_id is not null and not exists(select 1 from public.org_positions where id=p_position_id and department_id=p_department_id and organization_id=target_org and active) then raise exception 'Position must belong to the selected department'; end if;
  select role_key into profile_role from public.permission_profiles where id=p_permission_profile_id and organization_id=target_org and active;
  if profile_role is null then raise exception 'Active permission profile required'; end if;
  update public.staff_roles set department_id=p_department_id,position_id=p_position_id,permission_profile_id=p_permission_profile_id,reports_to_employee_id=p_reports_to_employee_id,
    department=(select name from public.org_departments where id=p_department_id),display_title=(select title from public.org_positions where id=p_position_id),role=profile_role,manager_user_id=p_reports_to_employee_id,updated_at=now() where user_id=p_employee_id;
  if old_manager is distinct from p_reports_to_employee_id then insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
    values(auth.uid(),p_employee_id,'CHANGE_EMPLOYEE_MANAGER','EMPLOYEE',p_employee_id::text,true,jsonb_build_object('previous_manager_id',old_manager,'manager_id',p_reports_to_employee_id)); end if;
end;$$;

create or replace function public.set_staff_active_v3(p_employee_id uuid,p_active boolean,p_reassign_reports_to uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare report_count integer;
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  if p_employee_id=auth.uid() and not p_active then raise exception 'You cannot deactivate your own account'; end if;
  select count(*) into report_count from public.staff_roles where reports_to_employee_id=p_employee_id and is_active;
  if not p_active and report_count>0 and p_reassign_reports_to is null then raise exception 'Reassign direct reports before deactivating this manager'; end if;
  if not p_active and report_count>0 then
    if p_reassign_reports_to=p_employee_id or not exists(select 1 from public.staff_roles where user_id=p_reassign_reports_to and is_active) then raise exception 'Active replacement manager required'; end if;
    update public.staff_roles set reports_to_employee_id=p_reassign_reports_to,manager_user_id=p_reassign_reports_to,updated_at=now() where reports_to_employee_id=p_employee_id and is_active;
    insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata) values(auth.uid(),p_employee_id,'REASSIGN_MANAGER_REPORTS','EMPLOYEE',p_employee_id::text,true,jsonb_build_object('report_count',report_count,'replacement_manager_id',p_reassign_reports_to));
  end if;
  update public.staff_roles set is_active=p_active,updated_at=now() where user_id=p_employee_id;
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata) values(auth.uid(),p_employee_id,case when p_active then 'RESTORE_STAFF' else 'SUSPEND_STAFF' end,'STAFF_ACCOUNT',p_employee_id::text,true,jsonb_build_object('active',p_active));
end;$$;

create or replace function public.manage_department_v1(p_department_id uuid,p_name text,p_description text,p_head_employee_id uuid,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; result_id uuid;
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
  if nullif(trim(p_name),'') is null then raise exception 'Department name required'; end if;
  if p_head_employee_id is not null and not exists(select 1 from public.staff_roles where user_id=p_head_employee_id and organization_id=org_id and is_active) then raise exception 'Department head must be an active employee'; end if;
  if not p_active and exists(select 1 from public.staff_roles where department_id=p_department_id and is_active) then raise exception 'Only an unused department can be archived'; end if;
  insert into public.org_departments(id,organization_id,name,description,department_head_employee_id,active) values(coalesce(p_department_id,gen_random_uuid()),org_id,trim(p_name),nullif(trim(p_description),''),p_head_employee_id,p_active)
  on conflict(id) do update set name=excluded.name,description=excluded.description,department_head_employee_id=excluded.department_head_employee_id,active=excluded.active,updated_at=now() returning id into result_id;
  insert into public.admin_access_logs(staff_user_id,action,resource_type,resource_id,success,metadata) values(auth.uid(),'MANAGE_DEPARTMENT','DEPARTMENT',result_id::text,true,jsonb_build_object('head_employee_id',p_head_employee_id,'active',p_active)); return result_id;
end;$$;

create or replace function public.manage_position_v1(p_position_id uuid,p_department_id uuid,p_title text,p_description text,p_management_level integer,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid; result_id uuid;
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
  if not exists(select 1 from public.org_departments where id=p_department_id and organization_id=org_id and active) then raise exception 'Active department required'; end if;
  if nullif(trim(p_title),'') is null then raise exception 'Position title required'; end if;
  if not p_active and exists(select 1 from public.staff_roles where position_id=p_position_id and is_active) then raise exception 'Only an unused position can be archived'; end if;
  insert into public.org_positions(id,organization_id,department_id,title,description,management_level,active) values(coalesce(p_position_id,gen_random_uuid()),org_id,p_department_id,trim(p_title),nullif(trim(p_description),''),greatest(0,least(p_management_level,20)),p_active)
  on conflict(id) do update set department_id=excluded.department_id,title=excluded.title,description=excluded.description,management_level=excluded.management_level,active=excluded.active,updated_at=now() returning id into result_id;
  insert into public.admin_access_logs(staff_user_id,action,resource_type,resource_id,success,metadata) values(auth.uid(),'MANAGE_POSITION','POSITION',result_id::text,true,jsonb_build_object('department_id',p_department_id,'active',p_active)); return result_id;
end;$$;

create or replace function public.staff_team_workspace_v3(p_query text default '',p_page integer default 1,p_page_size integer default 25,p_department_id text default 'ALL',p_position_id text default 'ALL',p_manager_id text default 'ALL',p_status text default 'ALL')
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; org_id uuid;
begin
 if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
 select organization_id into org_id from public.staff_roles where user_id=auth.uid() and is_active;
 p_page:=greatest(1,p_page);p_page_size:=greatest(1,least(p_page_size,100));
 with people as (
  select sr.user_id,u.email,coalesce(si.display_name,u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name') display_name,sr.is_active,sr.mfa_required,sr.last_active_at,
   sr.role,pp.id permission_profile_id,pp.name permission_profile,d.id department_id,d.name department,p.id position_id,p.title position,p.management_level,sr.reports_to_employee_id,
   coalesce(mi.display_name,mu.raw_user_meta_data->>'display_name',mu.email) manager_name,(select count(*) from public.staff_roles dr where dr.reports_to_employee_id=sr.user_id and dr.is_active) direct_reports_count,
   coalesce(si.status,case when sr.is_active then 'ACTIVE' else 'DISABLED' end) invitation_status,sr.created_at
  from public.staff_roles sr join auth.users u on u.id=sr.user_id left join public.staff_invitations si on si.user_id=sr.user_id
  left join public.permission_profiles pp on pp.id=sr.permission_profile_id left join public.org_departments d on d.id=sr.department_id left join public.org_positions p on p.id=sr.position_id
  left join auth.users mu on mu.id=sr.reports_to_employee_id left join public.staff_invitations mi on mi.user_id=mu.id where sr.organization_id=org_id
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
  'activity',coalesce((select jsonb_agg(jsonb_build_object('who',coalesce(au.email,l.staff_user_id::text),'action',l.action,'target',coalesce(l.resource_id,l.resource_type),'result',case when l.success then 'SUCCESS' else 'FAILED' end,'created_at',l.created_at) order by l.created_at desc) from public.admin_access_logs l left join auth.users au on au.id=l.staff_user_id where l.action in('CHANGE_EMPLOYEE_MANAGER','REASSIGN_MANAGER_REPORTS','MANAGE_DEPARTMENT','MANAGE_POSITION','SUSPEND_STAFF','RESTORE_STAFF') and l.created_at>now()-interval '90 days'),'[]'::jsonb)
 ) into result; return result;
end;$$;

create or replace function public.staff_employee_profile_v3(p_user_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
 select jsonb_build_object('identity',jsonb_build_object('user_id',sr.user_id,'email',u.email,'name',coalesce(si.display_name,u.raw_user_meta_data->>'display_name',u.email),'active',sr.is_active,'departmentId',sr.department_id,'department',d.name,'positionId',sr.position_id,'position',p.title,'permissionProfileId',sr.permission_profile_id,'permissionProfile',pp.name,'reportsToEmployeeId',sr.reports_to_employee_id,'manager',coalesce(mi.display_name,mu.raw_user_meta_data->>'display_name',mu.email),'directReports',(select count(*) from public.staff_roles x where x.reports_to_employee_id=sr.user_id and x.is_active)),
  'permissions',coalesce((select jsonb_agg(jsonb_build_object('key',m.permission_key,'description',m.description,'granted',m.granted,'source',m.source)) from public.owner_staff_permission_matrix(p_user_id)m),'[]'::jsonb),
  'activity',coalesce((select jsonb_agg(jsonb_build_object('action',l.action,'resource',l.resource_type,'result',l.success,'created_at',l.created_at) order by l.created_at desc) from public.admin_access_logs l where l.customer_user_id=p_user_id or l.staff_user_id=p_user_id),'[]'::jsonb)) into result
 from public.staff_roles sr join auth.users u on u.id=sr.user_id left join public.staff_invitations si on si.user_id=sr.user_id left join public.org_departments d on d.id=sr.department_id left join public.org_positions p on p.id=sr.position_id left join public.permission_profiles pp on pp.id=sr.permission_profile_id left join auth.users mu on mu.id=sr.reports_to_employee_id left join public.staff_invitations mi on mi.user_id=mu.id where sr.user_id=p_user_id; return result;
end;$$;

alter table public.permission_profiles enable row level security; alter table public.org_departments enable row level security; alter table public.org_positions enable row level security;
revoke all on public.permission_profiles,public.org_departments,public.org_positions from anon,authenticated;
revoke all on function public.manage_employee_organization(uuid,uuid,uuid,uuid,uuid),public.set_staff_active_v3(uuid,boolean,uuid),public.manage_department_v1(uuid,text,text,uuid,boolean),public.manage_position_v1(uuid,uuid,text,text,integer,boolean),public.staff_team_workspace_v3(text,integer,integer,text,text,text,text),public.staff_employee_profile_v3(uuid) from public;
grant execute on function public.manage_employee_organization(uuid,uuid,uuid,uuid,uuid),public.set_staff_active_v3(uuid,boolean,uuid),public.manage_department_v1(uuid,text,text,uuid,boolean),public.manage_position_v1(uuid,uuid,text,text,integer,boolean),public.staff_team_workspace_v3(text,integer,integer,text,text,text,text),public.staff_employee_profile_v3(uuid) to authenticated;

create index if not exists staff_roles_org_structure_idx on public.staff_roles(department_id,position_id,reports_to_employee_id,is_active);
create index if not exists org_positions_department_idx on public.org_positions(department_id,active,management_level desc);
notify pgrst,'reload schema';
