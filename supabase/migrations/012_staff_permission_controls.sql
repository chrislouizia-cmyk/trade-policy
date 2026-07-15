-- Trade Police v14: Individual staff permission controls and dedicated HQ portal.
-- Run after 011_organizations_staff_workspaces.sql.

create table if not exists public.staff_permission_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.staff_permissions(permission_key) on delete cascade,
  granted boolean not null,
  changed_by uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,permission_key)
);

alter table public.staff_permission_overrides enable row level security;
revoke all on public.staff_permission_overrides from anon,authenticated;

create or replace function public.has_staff_permission(p_permission text)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(
    (
      select spo.granted
      from public.staff_permission_overrides spo
      join public.staff_roles sr on sr.user_id=spo.user_id
      where spo.user_id=auth.uid()
        and spo.permission_key=p_permission
        and sr.is_active=true
      limit 1
    ),
    exists(
      select 1
      from public.staff_roles sr
      join public.role_permissions rp on rp.role=sr.role
      where sr.user_id=auth.uid()
        and sr.is_active=true
        and rp.permission_key=p_permission
    ),
    false
  )
$$;
revoke all on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to authenticated;

create or replace function public.staff_workspace_route()
returns text language plpgsql stable security definer set search_path=public as $$
declare r text;
begin
  select role into r from public.staff_roles where user_id=auth.uid() and is_active=true;
  if r is null then return null; end if;
  return '/hq';
end;$$;
revoke all on function public.staff_workspace_route() from public;
grant execute on function public.staff_workspace_route() to authenticated;


create or replace function public.current_staff_permissions()
returns table(permission_key text)
language sql stable security definer set search_path=public as $$
  select sp.permission_key
  from public.staff_permissions sp
  where public.has_staff_permission(sp.permission_key)
  order by sp.permission_key
$$;
revoke all on function public.current_staff_permissions() from public;
grant execute on function public.current_staff_permissions() to authenticated;

create or replace function public.staff_customer_directory(p_limit integer default 100)
returns table(
  customer_id uuid,
  email text,
  display_name text,
  plan text,
  subscription_status text,
  created_at timestamptz,
  strategy_count bigint,
  account_count bigint,
  analysis_count bigint,
  last_activity_at timestamptz
)
language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('customers.view_metadata') then
    raise exception 'Customer metadata permission denied';
  end if;
  return query
  select
    p.id,
    p.email,
    p.display_name,
    coalesce(p.plan,'BETA'),
    coalesce(p.subscription_status,'ACTIVE'),
    p.created_at,
    (select count(*) from public.strategy_profiles sp where sp.user_id=p.id and coalesce(sp.is_archived,false)=false),
    (select count(*) from public.trading_accounts ta where ta.user_id=p.id and coalesce(ta.is_archived,false)=false),
    (select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    (select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id)
  from public.profiles p
  order by p.created_at desc
  limit greatest(1,least(p_limit,500));
end;$$;
revoke all on function public.staff_customer_directory(integer) from public;
grant execute on function public.staff_customer_directory(integer) to authenticated;

create or replace function public.owner_staff_permission_matrix(p_user_id uuid)
returns table(
  permission_key text,
  description text,
  sensitive boolean,
  granted boolean,
  source text
)
language plpgsql security definer set search_path=public as $$
declare target_role text;
begin
  if not public.has_staff_permission('staff.manage') then
    raise exception 'Staff management permission denied';
  end if;

  select role into target_role
  from public.staff_roles
  where user_id=p_user_id;

  if target_role is null then
    raise exception 'Staff member not found';
  end if;

  return query
  select
    sp.permission_key,
    sp.description,
    sp.sensitive,
    coalesce(spo.granted, rp.permission_key is not null) as granted,
    case
      when spo.permission_key is not null then 'CUSTOM'
      when rp.permission_key is not null then 'ROLE_DEFAULT'
      else 'NOT_GRANTED'
    end as source
  from public.staff_permissions sp
  left join public.role_permissions rp
    on rp.permission_key=sp.permission_key and rp.role=target_role
  left join public.staff_permission_overrides spo
    on spo.permission_key=sp.permission_key and spo.user_id=p_user_id
  order by sp.sensitive,sp.permission_key;
end;$$;
revoke all on function public.owner_staff_permission_matrix(uuid) from public;
grant execute on function public.owner_staff_permission_matrix(uuid) to authenticated;

create or replace function public.owner_set_staff_permission(
  p_user_id uuid,
  p_permission text,
  p_granted boolean,
  p_reason text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare target_role text;
begin
  if not public.has_staff_permission('staff.manage') then
    raise exception 'Staff management permission denied';
  end if;

  select role into target_role from public.staff_roles where user_id=p_user_id;
  if target_role is null then raise exception 'Staff member not found'; end if;
  if target_role='OWNER' then raise exception 'Owner permissions cannot be reduced here'; end if;
  if not exists(select 1 from public.staff_permissions where permission_key=p_permission) then
    raise exception 'Unknown permission';
  end if;

  insert into public.staff_permission_overrides(user_id,permission_key,granted,changed_by,reason,updated_at)
  values(p_user_id,p_permission,p_granted,auth.uid(),nullif(trim(p_reason),''),now())
  on conflict(user_id,permission_key) do update set
    granted=excluded.granted,
    changed_by=auth.uid(),
    reason=excluded.reason,
    updated_at=now();

  insert into public.admin_access_logs(
    staff_user_id,customer_user_id,action,resource_type,resource_id,access_scope,success,metadata
  ) values(
    auth.uid(),p_user_id,'CHANGE_STAFF_PERMISSION','STAFF_PERMISSION',p_user_id::text,p_permission,true,
    jsonb_build_object('permission',p_permission,'granted',p_granted,'reason',p_reason)
  );
end;$$;
revoke all on function public.owner_set_staff_permission(uuid,text,boolean,text) from public;
grant execute on function public.owner_set_staff_permission(uuid,text,boolean,text) to authenticated;

insert into public.release_notes(version,title,summary,items,published,published_at)
values(
  '1.0.0-hq-separation',
  'Dedicated Trade Police HQ',
  'Customer and company workspaces are now separated, with individual staff permission controls.',
  '["Dedicated HQ portal","Customer portal no longer links to HQ","Individual permission controls","Expanded role workspaces","Improved dashboard hierarchy"]'::jsonb,
  true,
  now()
)
on conflict(version) do update set summary=excluded.summary,items=excluded.items,published=true,published_at=now();
