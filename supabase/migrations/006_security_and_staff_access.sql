-- Trade Police v7: security foundation and controlled staff access
-- Run after 005_active_trade_monitor.sql.

-- Strategy Builder supports a dynamic instrument catalog. Remove the original
-- three-symbol constraint while retaining non-empty symbols.
alter table public.trade_records
  drop constraint if exists trade_records_instrument_check;
alter table public.trade_records
  add constraint trade_records_instrument_nonempty
  check (length(trim(instrument)) between 1 and 30) not valid;
alter table public.trade_records validate constraint trade_records_instrument_nonempty;

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('SUPPORT','TECHNICIAN','SECURITY_ADMIN')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  assigned_staff_user_id uuid references auth.users(id) on delete set null,
  subject text not null,
  description text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN','WAITING_CUSTOMER','RESOLVED','CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.customer_access_grants (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references auth.users(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  access_scope text[] not null default array['TECHNICAL_LOGS'],
  reason text not null,
  approved_by_customer boolean not null default false,
  approved_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (access_scope <@ array['ACCOUNT_METADATA','TECHNICAL_LOGS','TRADE_DIAGNOSTICS']::text[])
);

create table if not exists public.admin_access_logs (
  id bigint generated always as identity primary key,
  staff_user_id uuid references auth.users(id) on delete set null,
  customer_user_id uuid references auth.users(id) on delete set null,
  ticket_id uuid references public.support_tickets(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  access_scope text,
  success boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','HIGH','CRITICAL')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_customer_idx
  on public.support_tickets(customer_user_id, created_at desc);
create index if not exists support_tickets_staff_idx
  on public.support_tickets(assigned_staff_user_id, status, created_at desc);
create index if not exists access_grants_lookup_idx
  on public.customer_access_grants(staff_user_id, customer_user_id, expires_at)
  where revoked_at is null;
create index if not exists admin_access_logs_staff_idx
  on public.admin_access_logs(staff_user_id, created_at desc);
create index if not exists security_events_user_idx
  on public.security_events(user_id, created_at desc);

alter table public.staff_roles enable row level security;
alter table public.support_tickets enable row level security;
alter table public.customer_access_grants enable row level security;
alter table public.admin_access_logs enable row level security;
alter table public.security_events enable row level security;

-- Customers can create and read their own tickets. Staff access is exposed only
-- through audited SECURITY DEFINER functions below; no broad staff table policy exists.
drop policy if exists "tickets_customer_select" on public.support_tickets;
create policy "tickets_customer_select" on public.support_tickets
  for select to authenticated using ((select auth.uid()) = customer_user_id);

drop policy if exists "tickets_customer_insert" on public.support_tickets;
create policy "tickets_customer_insert" on public.support_tickets
  for insert to authenticated with check ((select auth.uid()) = customer_user_id);

drop policy if exists "tickets_customer_update" on public.support_tickets;
create policy "tickets_customer_update" on public.support_tickets
  for update to authenticated
  using ((select auth.uid()) = customer_user_id)
  with check ((select auth.uid()) = customer_user_id);

drop policy if exists "grants_customer_select" on public.customer_access_grants;
create policy "grants_customer_select" on public.customer_access_grants
  for select to authenticated using ((select auth.uid()) = customer_user_id);

drop policy if exists "grants_customer_approve" on public.customer_access_grants;
create policy "grants_customer_approve" on public.customer_access_grants
  for update to authenticated
  using ((select auth.uid()) = customer_user_id)
  with check ((select auth.uid()) = customer_user_id);

drop policy if exists "security_events_own" on public.security_events;
create policy "security_events_own" on public.security_events
  for select to authenticated using ((select auth.uid()) = user_id);

-- No authenticated grants are provided for staff_roles or admin_access_logs.
-- They are intentionally accessible only by server-side service processes/RPCs.
revoke all on public.staff_roles from authenticated, anon;
revoke all on public.admin_access_logs from authenticated, anon;
revoke all on public.security_events from anon;
grant select, insert, update on public.support_tickets to authenticated;
grant select, update on public.customer_access_grants to authenticated;
grant select on public.security_events to authenticated;

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.staff_roles
  where user_id = auth.uid() and is_active = true
  limit 1
$$;

revoke all on function public.current_staff_role() from public;
grant execute on function public.current_staff_role() to authenticated;

create or replace function public.require_staff_mfa(required_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_role text;
  assurance text;
begin
  select role into staff_role
  from public.staff_roles
  where user_id = auth.uid() and is_active = true;

  if staff_role is null or not (staff_role = any(required_roles)) then
    raise exception 'Staff permission denied';
  end if;

  assurance := coalesce(auth.jwt() ->> 'aal', 'aal1');
  if assurance <> 'aal2' then
    raise exception 'MFA assurance level aal2 is required';
  end if;
end;
$$;

revoke all on function public.require_staff_mfa(text[]) from public;

-- Support sees account metadata only. This function never joins strategy,
-- rule, trade, image, or analysis tables.
create or replace function public.support_get_customer_metadata(
  target_customer uuid,
  target_ticket uuid
)
returns table (
  customer_id uuid,
  email text,
  display_name text,
  plan text,
  subscription_status text,
  account_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_staff_mfa(array['SUPPORT','TECHNICIAN','SECURITY_ADMIN']);

  if not exists (
    select 1 from public.support_tickets t
    where t.id = target_ticket
      and t.customer_user_id = target_customer
      and t.status in ('OPEN','WAITING_CUSTOMER')
      and (t.assigned_staff_user_id is null or t.assigned_staff_user_id = auth.uid())
  ) then
    raise exception 'An active assigned ticket is required';
  end if;

  insert into public.admin_access_logs (
    staff_user_id, customer_user_id, ticket_id, action,
    resource_type, access_scope, success
  ) values (
    auth.uid(), target_customer, target_ticket, 'READ',
    'CUSTOMER_ACCOUNT_METADATA', 'ACCOUNT_METADATA', true
  );

  return query
  select p.id, p.email, p.display_name, p.plan, p.subscription_status, p.created_at
  from public.profiles p
  where p.id = target_customer;
end;
$$;

revoke all on function public.support_get_customer_metadata(uuid, uuid) from public;
grant execute on function public.support_get_customer_metadata(uuid, uuid) to authenticated;

-- A technician can verify that a time-limited customer-approved grant exists.
-- Sensitive reads should happen through dedicated audited RPCs, never direct table grants.
create or replace function public.has_valid_customer_access(
  target_customer uuid,
  target_ticket uuid,
  requested_scope text
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  allowed boolean;
begin
  perform public.require_staff_mfa(array['TECHNICIAN','SECURITY_ADMIN']);

  select exists (
    select 1
    from public.customer_access_grants g
    where g.customer_user_id = target_customer
      and g.staff_user_id = auth.uid()
      and g.ticket_id = target_ticket
      and g.approved_by_customer = true
      and g.approved_at is not null
      and g.revoked_at is null
      and g.expires_at > now()
      and requested_scope = any(g.access_scope)
  ) into allowed;

  return allowed;
end;
$$;

revoke all on function public.has_valid_customer_access(uuid, uuid, text) from public;
grant execute on function public.has_valid_customer_access(uuid, uuid, text) to authenticated;

-- Explicitly retain owner-only policies for strategy data. Staff roles receive
-- no SELECT policy, so the support/admin panel cannot read customer rules.
alter table public.strategy_profiles force row level security;
alter table public.strategy_instruments force row level security;
alter table public.strategy_sessions force row level security;
alter table public.strategy_rules force row level security;
alter table public.strategy_stop_limits force row level security;
alter table public.strategy_exit_rules force row level security;
alter table public.strategy_trailing_rules force row level security;
alter table public.trade_records force row level security;
alter table public.active_trades force row level security;
alter table public.active_trade_events force row level security;
