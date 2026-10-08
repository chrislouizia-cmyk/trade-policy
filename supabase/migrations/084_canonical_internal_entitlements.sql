-- 084_canonical_internal_entitlements.sql
begin;

create table if not exists public.internal_entitlement_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_code text not null
    check (plan_code in ('FREE','PRIVATE_BETA','PRO','ELITE','TEAM','FOUNDER')),
  active boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.internal_entitlement_overrides enable row level security;
alter table public.internal_entitlement_overrides force row level security;

revoke all on table public.internal_entitlement_overrides from public, anon, authenticated;
grant all on table public.internal_entitlement_overrides to service_role;

insert into public.internal_entitlement_overrides (user_id, plan_code, active, reason)
values
  ('65a21633-51ea-419b-bd0c-e43f81c63b4e', 'FOUNDER', true, 'Founder entitlement migrated from server override'),
  ('cee066a8-a590-4c1a-9c56-5e1c3617ca26', 'FOUNDER', true, 'Founder entitlement migrated from server override'),
  ('935d9d88-893b-4163-b276-50bdb63c55e0', 'FOUNDER', true, 'Founder entitlement migrated from server override')
on conflict (user_id) do update
set plan_code = excluded.plan_code,
    active = excluded.active,
    reason = excluded.reason,
    updated_at = now();

create or replace function public.backtest_get_plan_code_for_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path=public
as $$
declare
  v_override text;
  v_plan text;
  v_status text;
  v_beta boolean;
begin
  if p_user_id is null then
    return 'FREE';
  end if;

  select upper(e.plan_code)
    into v_override
  from public.internal_entitlement_overrides e
  where e.user_id = p_user_id
    and e.active = true
  limit 1;

  if v_override in ('FREE','PRIVATE_BETA','PRO','ELITE','TEAM','FOUNDER') then
    return v_override;
  end if;

  select bs.plan, bs.status
    into v_plan, v_status
  from public.billing_subscriptions bs
  where bs.user_id = p_user_id
  order by bs.updated_at desc
  limit 1;

  if lower(coalesce(v_status,'')) in ('active','trialing')
     and upper(coalesce(v_plan,''))='FOUNDER' then
    return 'FOUNDER';
  end if;

  if lower(coalesce(v_status,'')) in ('active','trialing')
     and upper(coalesce(v_plan,''))='TEAM' then
    return 'TEAM';
  end if;

  select coalesce(p.is_beta_tester,false)
    into v_beta
  from public.profiles p
  where p.id = p_user_id;

  if coalesce(v_beta,false) then
    return 'PRIVATE_BETA';
  end if;

  if lower(coalesce(v_status,'')) in ('active','trialing')
     and upper(coalesce(v_plan,'')) in ('PRO','ELITE') then
    return upper(v_plan);
  end if;

  return 'FREE';
end;
$$;

revoke all on function public.backtest_get_plan_code_for_user(uuid)
  from public, anon, authenticated;
grant execute on function public.backtest_get_plan_code_for_user(uuid)
  to service_role;

commit;
