-- Trade Police v13: Organizations, staff workspaces and least-privilege permissions.
-- Run after 010_production_control_and_admin.sql.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  organization_type text not null default 'INTERNAL'
    check (organization_type in ('INTERNAL','CUSTOMER','WHITE_LABEL','PARTNER')),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','SUSPENDED','ARCHIVED')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_type text not null default 'CUSTOMER'
    check (membership_type in ('OWNER','STAFF','CUSTOMER')),
  status text not null default 'ACTIVE'
    check (status in ('INVITED','ACTIVE','SUSPENDED','REMOVED')),
  joined_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

alter table public.staff_roles add column if not exists organization_id uuid references public.organizations(id) on delete set null;
alter table public.staff_roles add column if not exists display_title text;
alter table public.staff_roles add column if not exists invited_by uuid references auth.users(id) on delete set null;
alter table public.staff_roles add column if not exists mfa_required boolean not null default true;
alter table public.staff_roles add column if not exists last_active_at timestamptz;
alter table public.staff_roles drop constraint if exists staff_roles_role_check;
alter table public.staff_roles add constraint staff_roles_role_check check (
  role in ('OWNER','HEAD_OF_SALES','COMPLIANCE_OFFICER','SUPPORT','TECHNICIAN','SECURITY_ADMIN')
);

create table if not exists public.staff_permissions (
  permission_key text primary key,
  description text not null,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role text not null,
  permission_key text not null references public.staff_permissions(permission_key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(role,permission_key)
);

create table if not exists public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  email text not null,
  display_name text,
  source text,
  stage text not null default 'NEW'
    check (stage in ('NEW','CONTACTED','TRIAL','QUALIFIED','CONVERTED','LOST')),
  assigned_to uuid references auth.users(id) on delete set null,
  next_follow_up_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  customer_user_id uuid references auth.users(id) on delete cascade,
  case_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','HIGH','CRITICAL')),
  status text not null default 'OPEN' check (status in ('OPEN','REVIEWING','RESOLVED','CLOSED')),
  summary text not null,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.feature_flags (
  flag_key text primary key,
  description text not null,
  enabled_for text[] not null default array['INTERNAL']::text[],
  is_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.release_notes (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  title text not null,
  summary text not null,
  items jsonb not null default '[]'::jsonb,
  published boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.staff_permissions(permission_key,description,sensitive) values
 ('hq.view','View Trade Police HQ overview',false),
 ('customers.view_metadata','View customer identity, plan and status metadata',false),
 ('customers.suspend','Suspend or restore a customer account',true),
 ('staff.view','View staff directory and role status',true),
 ('staff.manage','Invite, assign, suspend and update staff roles',true),
 ('organizations.view','View organizations',false),
 ('organizations.manage','Create and update organizations',true),
 ('sales.view','View sales pipeline and conversion summaries',false),
 ('sales.manage','Create and update leads and follow-up status',false),
 ('compliance.view','View compliance cases and audit metadata',true),
 ('compliance.manage','Resolve compliance cases and suspend accounts',true),
 ('support.view','View support tickets and customer account metadata',false),
 ('support.manage','Assign and resolve support tickets',false),
 ('system.health','View provider health, incidents and operational telemetry',true),
 ('feedback.view','View customer feedback queue',false),
 ('billing.view','View plan and subscription summaries',true),
 ('security.audit','View staff activity and security audit logs',true),
 ('feature_flags.manage','Manage staged feature rollouts',true)
on conflict(permission_key) do update set description=excluded.description,sensitive=excluded.sensitive;

-- Role bundles. Private strategies, screenshots and detailed trades are intentionally absent.
insert into public.role_permissions(role,permission_key) values
 ('OWNER','hq.view'),('OWNER','customers.view_metadata'),('OWNER','customers.suspend'),('OWNER','staff.view'),('OWNER','staff.manage'),('OWNER','organizations.view'),('OWNER','organizations.manage'),('OWNER','sales.view'),('OWNER','sales.manage'),('OWNER','compliance.view'),('OWNER','compliance.manage'),('OWNER','support.view'),('OWNER','support.manage'),('OWNER','system.health'),('OWNER','feedback.view'),('OWNER','billing.view'),('OWNER','security.audit'),('OWNER','feature_flags.manage'),
 ('HEAD_OF_SALES','hq.view'),('HEAD_OF_SALES','customers.view_metadata'),('HEAD_OF_SALES','sales.view'),('HEAD_OF_SALES','sales.manage'),('HEAD_OF_SALES','billing.view'),
 ('COMPLIANCE_OFFICER','hq.view'),('COMPLIANCE_OFFICER','customers.view_metadata'),('COMPLIANCE_OFFICER','compliance.view'),('COMPLIANCE_OFFICER','compliance.manage'),('COMPLIANCE_OFFICER','security.audit'),
 ('SUPPORT','hq.view'),('SUPPORT','customers.view_metadata'),('SUPPORT','support.view'),('SUPPORT','support.manage'),('SUPPORT','feedback.view'),
 ('TECHNICIAN','hq.view'),('TECHNICIAN','system.health'),('TECHNICIAN','support.view'),
 ('SECURITY_ADMIN','hq.view'),('SECURITY_ADMIN','staff.view'),('SECURITY_ADMIN','compliance.view'),('SECURITY_ADMIN','system.health'),('SECURITY_ADMIN','security.audit')
on conflict do nothing;

insert into public.feature_flags(flag_key,description,enabled_for,is_enabled) values
 ('ai_coach','Weekly AI coaching and discipline review',array['INTERNAL','FOUNDERS'],false),
 ('broker_sync','Read-only broker synchronization',array['INTERNAL'],false),
 ('automatic_execution','Automated execution after deterministic authorization',array['INTERNAL'],false),
 ('trade_replay','Recreate the decision context of a historical trade',array['INTERNAL','FOUNDERS'],false)
on conflict(flag_key) do nothing;

insert into public.release_notes(version,title,summary,items,published,published_at) values
 ('1.0.0-founders','Operation Blue Shield','A more focused, disciplined and professional Trade Police experience.',
  '["Compact command center","Trade Police Shield","Multiple strategies and accounts","Daily limits and Green Day Protection","Private Owner Console"]'::jsonb,true,now())
on conflict(version) do nothing;

create index if not exists organization_members_user_idx on public.organization_members(user_id,status);
create index if not exists staff_roles_org_idx on public.staff_roles(organization_id,role,is_active);
create index if not exists sales_leads_stage_idx on public.sales_leads(stage,created_at desc);
create index if not exists compliance_cases_status_idx on public.compliance_cases(status,severity,created_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.staff_permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.sales_leads enable row level security;
alter table public.compliance_cases enable row level security;
alter table public.feature_flags enable row level security;
alter table public.release_notes enable row level security;

revoke all on public.organizations,public.organization_members,public.staff_permissions,public.role_permissions,public.sales_leads,public.compliance_cases,public.feature_flags from anon,authenticated;
grant select on public.release_notes to authenticated;

create or replace function public.has_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.staff_roles sr
    join public.role_permissions rp on rp.role=sr.role
    where sr.user_id=auth.uid() and sr.is_active=true and rp.permission_key=p_permission
  )
$$;
revoke all on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to authenticated;

create or replace function public.staff_workspace_route()
returns text language plpgsql stable security definer set search_path=public as $$
declare r text;
begin
  select role into r from public.staff_roles where user_id=auth.uid() and is_active=true;
  return case r
    when 'OWNER' then '/admin'
    when 'HEAD_OF_SALES' then '/staff/sales'
    when 'COMPLIANCE_OFFICER' then '/staff/compliance'
    when 'SUPPORT' then '/staff/support'
    when 'TECHNICIAN' then '/staff/technical'
    when 'SECURITY_ADMIN' then '/staff/compliance'
    else null end;
end;$$;
revoke all on function public.staff_workspace_route() from public;
grant execute on function public.staff_workspace_route() to authenticated;

create or replace function public.ensure_internal_organization()
returns uuid language plpgsql security definer set search_path=public as $$
declare org_id uuid;
begin
  if not public.is_owner() then raise exception 'Owner permission denied'; end if;
  select id into org_id from public.organizations where slug='trade-police-hq';
  if org_id is null then
    insert into public.organizations(name,slug,organization_type,created_by)
    values('Trade Police HQ','trade-police-hq','INTERNAL',auth.uid()) returning id into org_id;
  end if;
  update public.staff_roles set organization_id=coalesce(organization_id,org_id) where user_id=auth.uid();
  insert into public.organization_members(organization_id,user_id,membership_type,status)
  values(org_id,auth.uid(),'OWNER','ACTIVE') on conflict do nothing;
  return org_id;
end;$$;
revoke all on function public.ensure_internal_organization() from public;
grant execute on function public.ensure_internal_organization() to authenticated;

create or replace function public.owner_assign_staff_by_email(p_email text,p_role text,p_title text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target_id uuid; org_id uuid;
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  if p_role not in ('HEAD_OF_SALES','COMPLIANCE_OFFICER','SUPPORT','TECHNICIAN','SECURITY_ADMIN') then raise exception 'Invalid staff role'; end if;
  select id into target_id from auth.users where lower(email)=lower(trim(p_email));
  if target_id is null then raise exception 'The person must create a Trade Police account before staff access can be assigned'; end if;
  org_id:=public.ensure_internal_organization();
  insert into public.staff_roles(user_id,role,is_active,organization_id,display_title,invited_by,updated_at)
  values(target_id,p_role,true,org_id,coalesce(nullif(trim(p_title),''),replace(initcap(lower(p_role)),'_',' ')),auth.uid(),now())
  on conflict(user_id) do update set role=excluded.role,is_active=true,organization_id=excluded.organization_id,display_title=excluded.display_title,invited_by=auth.uid(),updated_at=now();
  insert into public.organization_members(organization_id,user_id,membership_type,status)
  values(org_id,target_id,'STAFF','ACTIVE') on conflict(organization_id,user_id) do update set membership_type='STAFF',status='ACTIVE';
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success,metadata)
  values(auth.uid(),target_id,'ASSIGN_STAFF_ROLE','STAFF_ROLE',target_id::text,p_role,true,jsonb_build_object('title',p_title));
  return jsonb_build_object('user_id',target_id,'role',p_role,'organization_id',org_id);
end;$$;
revoke all on function public.owner_assign_staff_by_email(text,text,text) from public;
grant execute on function public.owner_assign_staff_by_email(text,text,text) to authenticated;

create or replace function public.owner_set_staff_active(p_user_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('staff.manage') then raise exception 'Staff management permission denied'; end if;
  update public.staff_roles set is_active=p_active,updated_at=now() where user_id=p_user_id and role<>'OWNER';
  insert into public.admin_access_logs(staff_user_id,customer_user_id,action,resource_type,resource_id,success,metadata)
  values(auth.uid(),p_user_id,case when p_active then 'RESTORE_STAFF' else 'SUSPEND_STAFF' end,'STAFF_ROLE',p_user_id::text,true,'{}'::jsonb);
end;$$;
revoke all on function public.owner_set_staff_active(uuid,boolean) from public;
grant execute on function public.owner_set_staff_active(uuid,boolean) to authenticated;

create or replace function public.owner_staff_directory()
returns table(user_id uuid,email text,display_name text,role text,display_title text,is_active boolean,mfa_required boolean,last_active_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  return query select sr.user_id,p.email,p.display_name,sr.role,sr.display_title,sr.is_active,sr.mfa_required,sr.last_active_at,sr.created_at
  from public.staff_roles sr left join public.profiles p on p.id=sr.user_id order by sr.created_at;
end;$$;
revoke all on function public.owner_staff_directory() from public;
grant execute on function public.owner_staff_directory() to authenticated;

create or replace function public.staff_workspace_overview()
returns jsonb language plpgsql security definer set search_path=public as $$
declare r text; result jsonb;
begin
  select role into r from public.staff_roles where user_id=auth.uid() and is_active=true;
  if r is null then raise exception 'Staff permission denied'; end if;
  update public.staff_roles set last_active_at=now() where user_id=auth.uid();
  if r='HEAD_OF_SALES' then
    select jsonb_build_object('role',r,'new_customers_30d',(select count(*) from public.profiles where created_at>=now()-interval '30 days'),'trial_customers',(select count(*) from public.profiles where subscription_status='TRIAL'),'active_subscriptions',(select count(*) from public.profiles where subscription_status='ACTIVE'),'open_leads',(select count(*) from public.sales_leads where stage not in ('CONVERTED','LOST')),'converted_leads',(select count(*) from public.sales_leads where stage='CONVERTED')) into result;
  elsif r in ('COMPLIANCE_OFFICER','SECURITY_ADMIN') then
    select jsonb_build_object('role',r,'open_cases',(select count(*) from public.compliance_cases where status in ('OPEN','REVIEWING')),'high_priority',(select count(*) from public.compliance_cases where status in ('OPEN','REVIEWING') and severity in ('HIGH','CRITICAL')),'open_incidents',(select count(*) from public.system_incidents where resolved_at is null),'audit_events_7d',(select count(*) from public.admin_access_logs where created_at>=now()-interval '7 days')) into result;
  elsif r='SUPPORT' then
    select jsonb_build_object('role',r,'open_tickets',(select count(*) from public.support_tickets where status in ('OPEN','WAITING_CUSTOMER')),'assigned_to_me',(select count(*) from public.support_tickets where assigned_staff_user_id=auth.uid() and status in ('OPEN','WAITING_CUSTOMER')),'open_feedback',(select count(*) from public.beta_feedback where status in ('OPEN','REVIEWING')),'customers',(select count(*) from public.profiles)) into result;
  elsif r='TECHNICIAN' then
    select jsonb_build_object('role',r,'open_incidents',(select count(*) from public.system_incidents where resolved_at is null),'critical_incidents',(select count(*) from public.system_incidents where resolved_at is null and severity='CRITICAL'),'failed_actions_today',(select count(*) from public.usage_events where success=false and created_at>=date_trunc('day',now())),'analyses_today',(select count(*) from public.usage_events where event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS') and created_at>=date_trunc('day',now()))) into result;
  else
    result:=public.admin_overview() || jsonb_build_object('role',r);
  end if;
  return result;
end;$$;
revoke all on function public.staff_workspace_overview() from public;
grant execute on function public.staff_workspace_overview() to authenticated;

create or replace function public.staff_recent_activity(p_limit integer default 25)
returns table(id bigint,action text,resource_type text,access_scope text,success boolean,created_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if public.current_staff_role() is null then raise exception 'Staff permission denied'; end if;
  return query select l.id,l.action,l.resource_type,l.access_scope,l.success,l.created_at
  from public.admin_access_logs l where l.staff_user_id=auth.uid() order by l.created_at desc limit greatest(1,least(p_limit,100));
end;$$;
revoke all on function public.staff_recent_activity(integer) from public;
grant execute on function public.staff_recent_activity(integer) to authenticated;
