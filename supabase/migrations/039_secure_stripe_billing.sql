-- Server-authoritative Stripe billing and idempotent analysis usage.
create table if not exists public.billing_subscriptions(
 user_id uuid primary key references auth.users(id) on delete cascade,
 stripe_customer_id text not null unique,
 stripe_subscription_id text unique,
 plan text not null default 'FREE' check(plan in('FREE','PRO','TEAM')),
 status text not null default 'inactive',current_period_end timestamptz,cancel_at_period_end boolean not null default false,
 payment_failed boolean not null default false,last_webhook_event_id text,last_webhook_created_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.stripe_webhook_events(event_id text primary key,event_type text not null,stripe_created_at timestamptz not null,processed_at timestamptz not null default now());
create table if not exists public.analysis_usage(id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,request_key text not null,period_start date not null,status text not null check(status in('RESERVED','COMPLETED','FAILED')),completed_at timestamptz,created_at timestamptz not null default now(),unique(user_id,request_key));
create index if not exists analysis_usage_period_idx on public.analysis_usage(user_id,period_start,status);
alter table public.billing_subscriptions enable row level security;alter table public.billing_subscriptions force row level security;
alter table public.stripe_webhook_events enable row level security;alter table public.stripe_webhook_events force row level security;
alter table public.analysis_usage enable row level security;alter table public.analysis_usage force row level security;
revoke all on public.billing_subscriptions,public.stripe_webhook_events,public.analysis_usage from anon,authenticated;
grant select on public.billing_subscriptions to authenticated;grant select on public.analysis_usage to authenticated;
create policy billing_select_own on public.billing_subscriptions for select to authenticated using(auth.uid()=user_id);
create policy analysis_usage_select_own on public.analysis_usage for select to authenticated using(auth.uid()=user_id);
-- Profiles are not billing authority; prevent customers from mutating legacy billing display columns.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_safe_own on public.profiles for update to authenticated using(auth.uid()=id) with check(auth.uid()=id);
create or replace function public.protect_profile_billing_fields() returns trigger language plpgsql security definer set search_path=public as $$ begin if auth.uid() is not null and (new.plan is distinct from old.plan or new.subscription_status is distinct from old.subscription_status) then raise exception 'Billing fields are server managed';end if;return new;end;$$;
drop trigger if exists protect_profile_billing_fields on public.profiles;
create trigger protect_profile_billing_fields before update on public.profiles for each row execute function public.protect_profile_billing_fields();
