-- Trade Police v15: Customer 360, separate HQ authentication and employee invitations.
-- Run after 012_staff_permission_controls.sql.

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists discord_handle text;
alter table public.profiles add column if not exists trial_started_at timestamptz;
alter table public.profiles add column if not exists trial_ends_at timestamptz;
alter table public.profiles add column if not exists renewal_at timestamptz;

alter table public.support_tickets add column if not exists priority text not null default 'NORMAL';
do $$ begin
  alter table public.support_tickets add constraint support_tickets_priority_check check (priority in ('LOW','NORMAL','HIGH','URGENT'));
exception when duplicate_object then null; end $$;

create table if not exists public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null check (role in ('HEAD_OF_SALES','COMPLIANCE_OFFICER','SUPPORT','TECHNICIAN','SECURITY_ADMIN')),
  display_title text,
  organization_id uuid references public.organizations(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'INVITED' check (status in ('INVITED','ACCEPTED','CANCELLED','EXPIRED')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  staff_user_id uuid references auth.users(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_follow_ups (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  due_at timestamptz not null,
  channel text not null default 'EMAIL' check (channel in ('EMAIL','PHONE','WHATSAPP','DISCORD','OTHER')),
  status text not null default 'OPEN' check (status in ('OPEN','COMPLETED','CANCELLED')),
  summary text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_invitations_status_idx on public.staff_invitations(status,invited_at desc);
create index if not exists customer_notes_customer_idx on public.customer_notes(customer_user_id,created_at desc);
create index if not exists customer_follow_ups_queue_idx on public.customer_follow_ups(status,due_at);

alter table public.staff_invitations enable row level security;
alter table public.customer_notes enable row level security;
alter table public.customer_follow_ups enable row level security;
revoke all on public.staff_invitations,public.customer_notes,public.customer_follow_ups from anon,authenticated;

-- A staff invitation must not create a customer profile.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_user_meta_data->>'account_type','customer') <> 'staff' then
    insert into public.profiles (id,email,display_name)
    values (new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name'))
    on conflict (id) do nothing;
  end if;
  return new;
end; $$;

create or replace function public.staff_workspace_route()
returns text language plpgsql stable security definer set search_path=public as $$
declare r text;
begin
  select role into r from public.staff_roles where user_id=auth.uid() and is_active=true;
  if r is null then return null; end if;
  return case r
    when 'OWNER' then '/hq'
    when 'HEAD_OF_SALES' then '/hq/sales'
    when 'COMPLIANCE_OFFICER' then '/hq/compliance'
    when 'SUPPORT' then '/hq/support'
    when 'TECHNICIAN' then '/hq/system'
    when 'SECURITY_ADMIN' then '/hq/compliance'
    else null end;
end;$$;
revoke all on function public.staff_workspace_route() from public;
grant execute on function public.staff_workspace_route() to authenticated;

-- Staff are identified from auth.users, not from customer profiles.
drop function if exists public.owner_staff_directory();
create function public.owner_staff_directory()
returns table(user_id uuid,email text,display_name text,role text,display_title text,is_active boolean,mfa_required boolean,last_active_at timestamptz,created_at timestamptz,invitation_status text)
language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('staff.view') then raise exception 'Staff directory permission denied'; end if;
  return query
  select sr.user_id,u.email,
    coalesce(si.display_name,u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'full_name'),
    sr.role,sr.display_title,sr.is_active,sr.mfa_required,sr.last_active_at,sr.created_at,si.status
  from public.staff_roles sr
  join auth.users u on u.id=sr.user_id
  left join public.staff_invitations si on si.user_id=sr.user_id
  order by sr.created_at;
end;$$;
revoke all on function public.owner_staff_directory() from public;
grant execute on function public.owner_staff_directory() to authenticated;

-- Customer lists explicitly exclude every staff identity.
drop function if exists public.staff_customer_directory(integer);
create function public.staff_customer_directory(p_limit integer default 100)
returns table(customer_id uuid,email text,display_name text,plan text,subscription_status text,created_at timestamptz,strategy_count bigint,account_count bigint,analysis_count bigint,last_activity_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if not public.has_staff_permission('customers.view_metadata') then raise exception 'Customer metadata permission denied'; end if;
  return query
  select p.id,p.email,p.display_name,coalesce(p.plan,'free'),coalesce(p.subscription_status,'inactive'),p.created_at,
    (select count(*) from public.strategy_profiles sp where sp.user_id=p.id and coalesce(sp.is_archived,false)=false),
    (select count(*) from public.trading_accounts ta where ta.user_id=p.id and coalesce(ta.is_archived,false)=false),
    (select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    (select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id)
  from public.profiles p
  where not exists(select 1 from public.staff_roles sr where sr.user_id=p.id)
  order by p.created_at desc limit greatest(1,least(p_limit,500));
end;$$;
revoke all on function public.staff_customer_directory(integer) from public;
grant execute on function public.staff_customer_directory(integer) to authenticated;

create or replace function public.staff_customer_360(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.has_staff_permission('customers.view_metadata') then raise exception 'Customer metadata permission denied'; end if;
  if exists(select 1 from public.staff_roles where user_id=p_customer_id) then return null; end if;

  select jsonb_build_object(
    'customer_id',p.id,'email',p.email,'display_name',p.display_name,'phone',p.phone,'discord_handle',p.discord_handle,
    'plan',p.plan,'subscription_status',p.subscription_status,'trial_started_at',p.trial_started_at,'trial_ends_at',p.trial_ends_at,
    'renewal_at',p.renewal_at,'created_at',p.created_at,
    'strategy_count',(select count(*) from public.strategy_profiles sp where sp.user_id=p.id and coalesce(sp.is_archived,false)=false),
    'account_count',(select count(*) from public.trading_accounts ta where ta.user_id=p.id and coalesce(ta.is_archived,false)=false),
    'analysis_count',(select count(*) from public.usage_events ue where ue.user_id=p.id and ue.event_type in ('MARKET_ANALYSIS','CHART_ANALYSIS')),
    'last_activity_at',(select max(ue.created_at) from public.usage_events ue where ue.user_id=p.id),
    'timeline',coalesce((
      select jsonb_agg(x order by (x->>'created_at')::timestamptz desc)
      from (
        select jsonb_build_object('type','NOTE','title','Internal note','detail',cn.note,'created_at',cn.created_at) x from public.customer_notes cn where cn.customer_user_id=p.id
        union all
        select jsonb_build_object('type','FOLLOW_UP','title','Follow-up · '||cf.channel,'detail',coalesce(cf.summary,cf.status),'created_at',cf.created_at) x from public.customer_follow_ups cf where cf.customer_user_id=p.id
        union all
        select jsonb_build_object('type','TICKET','title','Support ticket · '||st.subject,'detail',st.status||' · '||st.priority,'created_at',st.created_at) x from public.support_tickets st where st.customer_user_id=p.id
      ) timeline_rows
    ),'[]'::jsonb)
  ) into result from public.profiles p where p.id=p_customer_id;
  return result;
end;$$;
revoke all on function public.staff_customer_360(uuid) from public;
grant execute on function public.staff_customer_360(uuid) to authenticated;

insert into public.release_notes(version,title,summary,items,published,published_at)
values('1.1.0-hq-staff','HQ Staff Invitations and Customer 360','Employees can be invited directly into Headquarters without becoming customers.',
'["Dedicated HQ sign-in","Direct employee invitations","Role-based workspace routing","Staff/customer identity separation","Customer 360 profile"]'::jsonb,true,now())
on conflict(version) do update set summary=excluded.summary,items=excluded.items,published=true,published_at=now();
