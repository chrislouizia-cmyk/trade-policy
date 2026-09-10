-- 108_affiliate_foundation.sql
-- Canonical Trade Police Affiliate Foundation
--
-- Economic contract:
--   - approved affiliates only
--   - immutable first-touch attribution
--   - no self referrals
--   - 10% of eligible collected amount
--   - fixed 12-month window from first successful payment
--   - one earned commission per Stripe invoice
--   - 30-day hold before availability
--   - refunds/chargebacks are adjustments, never mutation of earned truth
--   - commissions are append-only economic records
--   - payouts are linked through payout items
--
-- This migration intentionally reconciles the pre-existing production
-- affiliate schema while remaining reproducible on a fresh database.


-- ============================================================
-- 1. CANONICAL TABLES
-- ============================================================

create table if not exists public.affiliate_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'PENDING',
  referral_code text not null,
  payout_threshold_minor integer not null default 2500,
  payout_currency text not null default 'USD',
  payout_method text not null default 'BANK_TRANSFER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_referral_touches (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete restrict,
  visitor_id uuid not null,
  referral_code text not null,
  first_touch_at timestamptz not null default now(),
  cookie_value text not null,
  cookie_expires_at timestamptz not null,
  is_self_referral boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete restrict,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  touch_id uuid not null references public.affiliate_referral_touches(id) on delete restrict,
  status text not null default 'ATTRIBUTED',
  attributed_at timestamptz not null default now(),
  account_created_at timestamptz not null default now(),
  first_successful_payment_at timestamptz,
  immutable_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete restrict,
  referral_id uuid not null references public.affiliate_referrals(id) on delete restrict,
  stripe_invoice_id text not null,
  currency text not null,
  eligible_amount_minor integer not null,
  commission_amount_minor integer not null,
  commission_rate numeric(7,6) not null default 0.100000,
  status text not null default 'PENDING',
  eligible_from timestamptz not null,
  eligible_until timestamptz not null,
  hold_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.affiliate_commissions(id) on delete restrict,
  adjustment_type text not null,
  amount_minor integer not null,
  currency text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid not null
);

create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_profiles(id) on delete restrict,
  payout_period_start timestamptz not null,
  payout_period_end timestamptz not null,
  status text not null default 'PENDING',
  currency text not null,
  total_minor integer not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid
);

create table if not exists public.affiliate_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.affiliate_payouts(id) on delete restrict,
  commission_id uuid not null references public.affiliate_commissions(id) on delete restrict,
  amount_minor integer not null,
  currency text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid
);

create table if not exists public.affiliate_audit_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  administrator_id uuid,
  reason text not null,
  occurred_at timestamptz not null default now(),
  audit_fingerprint text not null
);


-- ============================================================
-- 2. RECONCILE EXISTING PRODUCTION SHAPE
-- ============================================================

alter table public.affiliate_profiles
  alter column status set default 'PENDING';

alter table public.affiliate_commissions
  alter column commission_rate set default 0.100000;

-- All existing tables are currently empty, but these defaults are only
-- defaults. Runtime functions below remain authoritative.


-- ============================================================
-- 3. RECONCILE LEGACY CONSTRAINTS / FKs / INDEXES
-- ============================================================

-- Production already contained an untracked Affiliate schema.
-- Because those tables are empty, 108 normalizes its legacy constraints
-- to the canonical economic contract instead of preserving incompatible
-- uniqueness, status, or cascade-delete semantics.

-- ------------------------------------------------------------
-- 3A. Remove legacy uniqueness that incorrectly limits a referral
--     to one lifetime commission.
-- ------------------------------------------------------------

alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_referral_id_key;


-- ------------------------------------------------------------
-- 3B. Normalize status contracts.
-- ------------------------------------------------------------

alter table public.affiliate_profiles
  drop constraint if exists affiliate_profiles_status_check;

alter table public.affiliate_profiles
  add constraint affiliate_profiles_status_check
  check (
    status in (
      'PENDING',
      'APPROVED',
      'REJECTED',
      'SUSPENDED',
      'PAUSED',
      'DISABLED'
    )
  );


alter table public.affiliate_referrals
  drop constraint if exists affiliate_referrals_status_check;

alter table public.affiliate_referrals
  add constraint affiliate_referrals_status_check
  check (
    status in (
      'ATTRIBUTED',
      'EARNING',
      'REJECTED',
      'DISPUTED'
    )
  );


alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_status_check;

alter table public.affiliate_commissions
  add constraint affiliate_commissions_status_check
  check (
    status in (
      'PENDING',
      'AVAILABLE',
      'PAID',
      'REVERSED',
      'VOID'
    )
  );


-- ------------------------------------------------------------
-- 3C. Preserve financial/audit history.
--     No Affiliate financial lineage should disappear because a user,
--     affiliate profile, payout, referral, or commission was deleted.
-- ------------------------------------------------------------

alter table public.affiliate_profiles
  drop constraint if exists affiliate_profiles_user_id_fkey;

alter table public.affiliate_profiles
  add constraint affiliate_profiles_user_id_fkey
  foreign key (user_id)
  references auth.users(id)
  on delete restrict;


alter table public.affiliate_referral_touches
  drop constraint if exists affiliate_referral_touches_affiliate_id_fkey;

alter table public.affiliate_referral_touches
  add constraint affiliate_referral_touches_affiliate_id_fkey
  foreign key (affiliate_id)
  references public.affiliate_profiles(id)
  on delete restrict;


alter table public.affiliate_referrals
  drop constraint if exists affiliate_referrals_affiliate_id_fkey;

alter table public.affiliate_referrals
  add constraint affiliate_referrals_affiliate_id_fkey
  foreign key (affiliate_id)
  references public.affiliate_profiles(id)
  on delete restrict;


alter table public.affiliate_referrals
  drop constraint if exists affiliate_referrals_referred_user_id_fkey;

alter table public.affiliate_referrals
  add constraint affiliate_referrals_referred_user_id_fkey
  foreign key (referred_user_id)
  references auth.users(id)
  on delete restrict;


alter table public.affiliate_commissions
  drop constraint if exists affiliate_commissions_affiliate_id_fkey;

alter table public.affiliate_commissions
  add constraint affiliate_commissions_affiliate_id_fkey
  foreign key (affiliate_id)
  references public.affiliate_profiles(id)
  on delete restrict;


alter table public.affiliate_commission_adjustments
  drop constraint if exists affiliate_commission_adjustments_commission_id_fkey;

alter table public.affiliate_commission_adjustments
  add constraint affiliate_commission_adjustments_commission_id_fkey
  foreign key (commission_id)
  references public.affiliate_commissions(id)
  on delete restrict;


alter table public.affiliate_payouts
  drop constraint if exists affiliate_payouts_affiliate_id_fkey;

alter table public.affiliate_payouts
  add constraint affiliate_payouts_affiliate_id_fkey
  foreign key (affiliate_id)
  references public.affiliate_profiles(id)
  on delete restrict;


alter table public.affiliate_payout_items
  drop constraint if exists affiliate_payout_items_payout_id_fkey;

alter table public.affiliate_payout_items
  add constraint affiliate_payout_items_payout_id_fkey
  foreign key (payout_id)
  references public.affiliate_payouts(id)
  on delete restrict;


-- ------------------------------------------------------------
-- 3D. Canonical uniqueness / lookup indexes.
-- ------------------------------------------------------------

create unique index if not exists affiliate_profiles_user_uidx
  on public.affiliate_profiles(user_id);

create unique index if not exists affiliate_profiles_referral_code_uidx
  on public.affiliate_profiles(upper(referral_code));

create unique index if not exists affiliate_referrals_referred_user_uidx
  on public.affiliate_referrals(referred_user_id);

create unique index if not exists affiliate_commissions_invoice_uidx
  on public.affiliate_commissions(stripe_invoice_id);

create unique index if not exists affiliate_payout_items_commission_uidx
  on public.affiliate_payout_items(commission_id);

create index if not exists affiliate_touches_affiliate_idx
  on public.affiliate_referral_touches(affiliate_id);

create index if not exists affiliate_referrals_affiliate_idx
  on public.affiliate_referrals(affiliate_id);

create index if not exists affiliate_commissions_affiliate_idx
  on public.affiliate_commissions(affiliate_id);

create index if not exists affiliate_commissions_referral_idx
  on public.affiliate_commissions(referral_id);

create index if not exists affiliate_commissions_status_hold_idx
  on public.affiliate_commissions(status, hold_until);

create index if not exists affiliate_payouts_affiliate_idx
  on public.affiliate_payouts(affiliate_id);


-- ------------------------------------------------------------
-- 3E. Additional economic integrity constraints.
-- ------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_commissions_amount_check'
      and conrelid = 'public.affiliate_commissions'::regclass
  ) then
    alter table public.affiliate_commissions
      add constraint affiliate_commissions_amount_check
      check (
        eligible_amount_minor >= 0
        and commission_amount_minor >= 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_commissions_window_check'
      and conrelid = 'public.affiliate_commissions'::regclass
  ) then
    alter table public.affiliate_commissions
      add constraint affiliate_commissions_window_check
      check (
        eligible_until > eligible_from
        and hold_until >= created_at
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'affiliate_commissions_currency_check'
      and conrelid = 'public.affiliate_commissions'::regclass
  ) then
    alter table public.affiliate_commissions
      add constraint affiliate_commissions_currency_check
      check (currency ~ '^[A-Z]{3}$');
  end if;
end
$$;


-- ============================================================
-- 4. IMMUTABILITY
-- ============================================================

create or replace function public.protect_affiliate_referral_truth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.affiliate_id is distinct from new.affiliate_id
     or old.referred_user_id is distinct from new.referred_user_id
     or old.touch_id is distinct from new.touch_id
     or old.attributed_at is distinct from new.attributed_at
     or old.account_created_at is distinct from new.account_created_at
     or old.immutable_at is distinct from new.immutable_at
  then
    raise exception 'AFFILIATE_REFERRAL_ATTRIBUTION_IMMUTABLE';
  end if;

  if old.first_successful_payment_at is not null
     and old.first_successful_payment_at
         is distinct from new.first_successful_payment_at
  then
    raise exception 'AFFILIATE_FIRST_PAYMENT_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_affiliate_referral_truth_trigger
  on public.affiliate_referrals;

create trigger protect_affiliate_referral_truth_trigger
before update on public.affiliate_referrals
for each row
execute function public.protect_affiliate_referral_truth();


create or replace function public.protect_affiliate_commission_truth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'AFFILIATE_COMMISSION_LEDGER_APPEND_ONLY';
  end if;

  if old.affiliate_id is distinct from new.affiliate_id
     or old.referral_id is distinct from new.referral_id
     or old.stripe_invoice_id is distinct from new.stripe_invoice_id
     or old.currency is distinct from new.currency
     or old.eligible_amount_minor is distinct from new.eligible_amount_minor
     or old.commission_amount_minor is distinct from new.commission_amount_minor
     or old.commission_rate is distinct from new.commission_rate
     or old.eligible_from is distinct from new.eligible_from
     or old.eligible_until is distinct from new.eligible_until
     or old.hold_until is distinct from new.hold_until
     or old.created_at is distinct from new.created_at
  then
    raise exception 'AFFILIATE_COMMISSION_ECONOMIC_TRUTH_IMMUTABLE';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_affiliate_commission_truth_update_trigger
  on public.affiliate_commissions;

create trigger protect_affiliate_commission_truth_update_trigger
before update on public.affiliate_commissions
for each row
execute function public.protect_affiliate_commission_truth();

drop trigger if exists protect_affiliate_commission_truth_delete_trigger
  on public.affiliate_commissions;

create trigger protect_affiliate_commission_truth_delete_trigger
before delete on public.affiliate_commissions
for each row
execute function public.protect_affiliate_commission_truth();


-- ============================================================
-- 5. ATTRIBUTION
-- ============================================================

create or replace function public.bind_affiliate_referral(
  p_referral_code text,
  p_referred_user_id uuid,
  p_touch_cookie_value text,
  p_cookie_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.affiliate_profiles%rowtype;
  v_touch public.affiliate_referral_touches%rowtype;
  v_existing public.affiliate_referrals%rowtype;
  v_now timestamptz := now();
  v_id uuid;
begin
  if nullif(trim(p_referral_code), '') is null
     or p_referred_user_id is null
     or nullif(trim(p_touch_cookie_value), '') is null
  then
    raise exception 'INVALID_AFFILIATE_BINDING_INPUT';
  end if;

  select *
  into v_existing
  from public.affiliate_referrals
  where referred_user_id = p_referred_user_id
  limit 1;

  if found then
    return v_existing.id;
  end if;

  select *
  into v_profile
  from public.affiliate_profiles
  where upper(referral_code) = upper(trim(p_referral_code))
    and status = 'APPROVED'
  limit 1;

  if not found then
    raise exception 'AFFILIATE_UNAVAILABLE';
  end if;

  if v_profile.user_id = p_referred_user_id then
    raise exception 'AFFILIATE_SELF_REFERRAL';
  end if;

  select *
  into v_touch
  from public.affiliate_referral_touches
  where affiliate_id = v_profile.id
    and cookie_value = p_touch_cookie_value
    and referral_code = v_profile.referral_code
    and cookie_expires_at > v_now
    and cookie_expires_at = p_cookie_expires_at
    and is_active = true
    and is_self_referral = false
  order by first_touch_at asc
  limit 1;

  if not found then
    raise exception 'AFFILIATE_REFERRAL_COOKIE_UNAVAILABLE';
  end if;

  insert into public.affiliate_referrals(
    affiliate_id,
    referred_user_id,
    touch_id,
    status,
    attributed_at,
    account_created_at,
    immutable_at
  )
  values (
    v_profile.id,
    p_referred_user_id,
    v_touch.id,
    'ATTRIBUTED',
    v_now,
    v_now,
    v_now
  )
  returning id into v_id;

  update public.affiliate_referral_touches
  set is_active = false
  where id = v_touch.id;

  return v_id;

exception
  when unique_violation then
    select id
    into v_id
    from public.affiliate_referrals
    where referred_user_id = p_referred_user_id
    limit 1;

    if v_id is not null then
      return v_id;
    end if;

    raise;
end;
$$;


-- Disable unsafe direct attribution path.
revoke all
on function public.attribute_affiliate_referral(uuid, uuid, uuid)
from public, anon, authenticated;


-- ============================================================
-- 6. COMMISSION ENGINE
-- ============================================================

create or replace function public.record_affiliate_commission(
  p_affiliate_id uuid,
  p_referral_id uuid,
  p_stripe_invoice_id text,
  p_currency text,
  p_eligible_amount_minor integer,
  p_commission_amount_minor integer,
  p_eligible_from timestamptz,
  p_eligible_until timestamptz,
  p_hold_until timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral public.affiliate_referrals%rowtype;
  v_id uuid;
  v_first_payment timestamptz;
  v_window_end timestamptz;
  v_commission integer;
  v_now timestamptz := now();
begin
  if p_affiliate_id is null
     or p_referral_id is null
     or nullif(trim(p_stripe_invoice_id), '') is null
     or p_eligible_amount_minor is null
     or p_eligible_amount_minor < 0
  then
    raise exception 'INVALID_AFFILIATE_COMMISSION_INPUT';
  end if;

  -- Economic idempotency wins before any referral/window mutation.
  -- A replay of an already-recorded Stripe invoice returns the
  -- canonical commission and cannot start or alter the 12-month clock.
  select id
    into v_id
  from public.affiliate_commissions
  where stripe_invoice_id = p_stripe_invoice_id
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select *
  into v_referral
  from public.affiliate_referrals
  where id = p_referral_id
  for update;

  if not found then
    raise exception 'AFFILIATE_REFERRAL_NOT_FOUND';
  end if;

  if v_referral.affiliate_id <> p_affiliate_id then
    raise exception 'AFFILIATE_COMMISSION_LINEAGE_MISMATCH';
  end if;

  v_first_payment :=
    coalesce(v_referral.first_successful_payment_at, p_eligible_from);

  if v_first_payment is null then
    raise exception 'AFFILIATE_FIRST_PAYMENT_REQUIRED';
  end if;

  if v_referral.first_successful_payment_at is null then
    update public.affiliate_referrals
    set
      first_successful_payment_at = v_first_payment,
      status = 'EARNING'
    where id = v_referral.id;
  end if;

  v_window_end := v_first_payment + interval '12 months';

  -- The actual paid invoice timestamp must be inside the fixed
  -- first-year eligibility window.
  if p_eligible_from < v_first_payment
     or p_eligible_from >= v_window_end
  then
    raise exception 'AFFILIATE_COMMISSION_OUTSIDE_ELIGIBILITY_WINDOW';
  end if;

  -- Database, not caller, owns the economic calculation.
  v_commission :=
    round(p_eligible_amount_minor::numeric * 0.10)::integer;

  insert into public.affiliate_commissions(
    affiliate_id,
    referral_id,
    stripe_invoice_id,
    currency,
    eligible_amount_minor,
    commission_amount_minor,
    commission_rate,
    status,
    eligible_from,
    eligible_until,
    hold_until
  )
  values (
    p_affiliate_id,
    p_referral_id,
    p_stripe_invoice_id,
    upper(trim(p_currency)),
    p_eligible_amount_minor,
    v_commission,
    0.100000,
    'PENDING',
    p_eligible_from,
    v_window_end,
    greatest(
      coalesce(p_hold_until, v_now + interval '30 days'),
      v_now
    )
  )
  on conflict (stripe_invoice_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id
    into v_id
    from public.affiliate_commissions
    where stripe_invoice_id = p_stripe_invoice_id
    limit 1;
  end if;

  return v_id;
end;
$$;


-- ============================================================
-- 7. MATURITY
-- ============================================================

create or replace function public.mature_affiliate_commissions(
  p_dry_run boolean default true
)
returns table(matured_count bigint, audit_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint := 0;
  v_audit_count bigint := 0;
  v_id uuid;
begin
  for v_id in
    select id
    from public.affiliate_commissions
    where status = 'PENDING'
      and hold_until <= now()
  loop
    if not p_dry_run then
      update public.affiliate_commissions
      set
        status = 'AVAILABLE',
        updated_at = now()
      where id = v_id;

      perform public.record_affiliate_audit_event(
        'affiliate_commission',
        v_id,
        'MATURED',
        null,
        jsonb_build_object('status', 'AVAILABLE'),
        null,
        'Commission matured after hold period.'
      );
    end if;

    v_count := v_count + 1;
  end loop;

  if not p_dry_run then
    v_audit_count := v_count;
  end if;

  return query select v_count, v_audit_count;
end;
$$;


-- ============================================================
-- 8. ADJUSTMENTS + BALANCES
-- ============================================================

create or replace function public.affiliate_balances(
  p_affiliate_id uuid
)
returns table(
  pending_minor integer,
  available_minor integer,
  paid_minor integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_is_service_role boolean :=
    coalesce(auth.role(), '') = 'service_role';
begin
  if p_affiliate_id is null then
    raise exception 'AFFILIATE_ID_REQUIRED';
  end if;

  -- SECURITY DEFINER must never become an IDOR/BOLA path.
  -- service_role may inspect any affiliate; authenticated callers
  -- may inspect only the affiliate profile attached to themselves.
  if not v_is_service_role then
    if v_caller is null then
      raise exception 'AUTH_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.affiliate_profiles ap
      where ap.id = p_affiliate_id
        and ap.user_id = v_caller
    ) then
      raise exception 'AFFILIATE_BALANCE_FORBIDDEN';
    end if;
  end if;

  return query
  with commission_net as (
    select
      c.id,
      c.status,
      greatest(
        c.commission_amount_minor
        - coalesce((
            select sum(a.amount_minor)
            from public.affiliate_commission_adjustments a
            where a.commission_id = c.id
          ), 0),
        0
      )::integer as net_minor
    from public.affiliate_commissions c
    where c.affiliate_id = p_affiliate_id
  )
  select
    coalesce(sum(net_minor) filter (where status = 'PENDING'), 0)::integer,
    coalesce(sum(net_minor) filter (where status = 'AVAILABLE'), 0)::integer,
    coalesce((
      select sum(pi.amount_minor)
      from public.affiliate_payout_items pi
      join public.affiliate_payouts p
        on p.id = pi.payout_id
      where p.affiliate_id = p_affiliate_id
        and p.status = 'PAID'
    ), 0)::integer
  from commission_net;
end;
$$;


-- ============================================================
-- 9. RLS
-- ============================================================

alter table public.affiliate_profiles enable row level security;
alter table public.affiliate_referral_touches enable row level security;
alter table public.affiliate_referrals enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_commission_adjustments enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_payout_items enable row level security;
alter table public.affiliate_audit_events enable row level security;


drop policy if exists "affiliate profiles select own"
  on public.affiliate_profiles;

create policy "affiliate profiles select own"
on public.affiliate_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);


drop policy if exists "affiliate referrals select own affiliate"
  on public.affiliate_referrals;

create policy "affiliate referrals select own affiliate"
on public.affiliate_referrals
for select
to authenticated
using (
  exists (
    select 1
    from public.affiliate_profiles ap
    where ap.id = affiliate_referrals.affiliate_id
      and ap.user_id = (select auth.uid())
  )
);


drop policy if exists "affiliate referrals select referred user"
  on public.affiliate_referrals;

create policy "affiliate referrals select referred user"
on public.affiliate_referrals
for select
to authenticated
using (referred_user_id = (select auth.uid()));


drop policy if exists "affiliate commissions select own affiliate"
  on public.affiliate_commissions;

create policy "affiliate commissions select own affiliate"
on public.affiliate_commissions
for select
to authenticated
using (
  exists (
    select 1
    from public.affiliate_profiles ap
    where ap.id = affiliate_commissions.affiliate_id
      and ap.user_id = (select auth.uid())
  )
);


drop policy if exists "affiliate payouts select own affiliate"
  on public.affiliate_payouts;

create policy "affiliate payouts select own affiliate"
on public.affiliate_payouts
for select
to authenticated
using (
  exists (
    select 1
    from public.affiliate_profiles ap
    where ap.id = affiliate_payouts.affiliate_id
      and ap.user_id = (select auth.uid())
  )
);


drop policy if exists "affiliate payout items select own affiliate"
  on public.affiliate_payout_items;

create policy "affiliate payout items select own affiliate"
on public.affiliate_payout_items
for select
to authenticated
using (
  exists (
    select 1
    from public.affiliate_payouts p
    join public.affiliate_profiles ap
      on ap.id = p.affiliate_id
    where p.id = affiliate_payout_items.payout_id
      and ap.user_id = (select auth.uid())
  )
);


-- ============================================================
-- 10. PRIVILEGE BOUNDARY
-- ============================================================

revoke all on table public.affiliate_profiles
  from anon, authenticated;
revoke all on table public.affiliate_referral_touches
  from anon, authenticated;
revoke all on table public.affiliate_referrals
  from anon, authenticated;
revoke all on table public.affiliate_commissions
  from anon, authenticated;
revoke all on table public.affiliate_commission_adjustments
  from anon, authenticated;
revoke all on table public.affiliate_payouts
  from anon, authenticated;
revoke all on table public.affiliate_payout_items
  from anon, authenticated;
revoke all on table public.affiliate_audit_events
  from anon, authenticated;

grant select on table public.affiliate_profiles
  to authenticated;
grant select on table public.affiliate_referrals
  to authenticated;
grant select on table public.affiliate_commissions
  to authenticated;
grant select on table public.affiliate_payouts
  to authenticated;
grant select on table public.affiliate_payout_items
  to authenticated;


-- Internal financial/state-changing functions.
revoke all on function public.record_affiliate_commission(
  uuid, uuid, text, text, integer, integer,
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.record_affiliate_commission(
  uuid, uuid, text, text, integer, integer,
  timestamptz, timestamptz, timestamptz
) to service_role;

revoke all on function public.mature_affiliate_commissions(boolean)
  from public, anon, authenticated;
grant execute on function public.mature_affiliate_commissions(boolean)
  to service_role;

revoke all on function public.record_affiliate_adjustment(
  uuid, text, integer, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_affiliate_adjustment(
  uuid, text, integer, text, text, uuid
) to service_role;

revoke all on function public.create_affiliate_payout(
  uuid, timestamptz, timestamptz, text, integer
) from public, anon, authenticated;
grant execute on function public.create_affiliate_payout(
  uuid, timestamptz, timestamptz, text, integer
) to service_role;

revoke all on function public.record_affiliate_payout_item(
  uuid, uuid, integer, text, text
) from public, anon, authenticated;
grant execute on function public.record_affiliate_payout_item(
  uuid, uuid, integer, text, text
) to service_role;

revoke all on function public.record_affiliate_audit_event(
  text, uuid, text, jsonb, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_affiliate_audit_event(
  text, uuid, text, jsonb, jsonb, uuid, text
) to service_role;

revoke all on function public.create_affiliate_profile(uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_affiliate_profile(uuid, text)
  to service_role;

revoke all on function public.record_affiliate_touch(
  uuid, uuid, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.record_affiliate_touch(
  uuid, uuid, text, text, timestamptz, boolean
) to service_role;

revoke all on function public.bind_affiliate_referral(
  text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.bind_affiliate_referral(
  text, uuid, text, timestamptz
) to service_role;

revoke all on function public.affiliate_balances(uuid)
  from public, anon;
grant execute on function public.affiliate_balances(uuid)
  to authenticated, service_role;

revoke all on function public.protect_affiliate_referral_truth()
  from public, anon, authenticated;

revoke all on function public.protect_affiliate_commission_truth()
  from public, anon, authenticated;
