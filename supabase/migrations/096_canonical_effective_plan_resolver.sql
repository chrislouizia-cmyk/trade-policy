begin;

create or replace function public.get_effective_plan_code_for_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override text;
  v_plan text;
  v_status text;
  v_ledger_status text;
  v_legacy_beta boolean;
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

  if v_override in ('FREE', 'PRIVATE_BETA', 'PRO', 'ELITE', 'TEAM', 'FOUNDER') then
    return v_override;
  end if;

  if exists (
    select 1
    from public.billing_subscriptions bs
    where bs.user_id = p_user_id
      and upper(bs.plan) = 'FOUNDER'
      and lower(bs.status) in ('active', 'trialing')
  ) then
    return 'FOUNDER';
  end if;

  if exists (
    select 1
    from public.billing_subscriptions bs
    where bs.user_id = p_user_id
      and upper(bs.plan) = 'TEAM'
      and lower(bs.status) in ('active', 'trialing')
  ) then
    return 'TEAM';
  end if;

  select bs.plan, bs.status
    into v_plan, v_status
  from public.billing_subscriptions bs
  where bs.user_id = p_user_id
  order by bs.updated_at desc
  limit 1;

  if lower(coalesce(v_status, '')) in ('active', 'trialing')
     and upper(coalesce(v_plan, '')) in ('PRO', 'ELITE') then
    return upper(v_plan);
  end if;

  select upper(a.status)
    into v_ledger_status
  from public.private_beta_applications a
  where a.user_id = p_user_id
  order by a.reviewed_at desc nulls last, a.created_at desc
  limit 1;

  if v_ledger_status = 'APPROVED' then
    return 'PRIVATE_BETA';
  end if;

  select coalesce(p.is_beta_tester, false)
    into v_legacy_beta
  from public.profiles p
  where p.id = p_user_id;

  if coalesce(v_legacy_beta, false) then
    if exists (
      select 1
      from public.private_beta_applications a
      where a.user_id = p_user_id
        and upper(a.status) in ('PENDING', 'WAITLISTED', 'REJECTED', 'APPROVED')
    ) then
      return 'FREE';
    end if;
    return 'PRIVATE_BETA';
  end if;

  return 'FREE';
end;
$$;

revoke all on function public.get_effective_plan_code_for_user(uuid) from public, anon, authenticated;
grant execute on function public.get_effective_plan_code_for_user(uuid) to service_role;

create or replace function public.backtest_get_plan_code_for_user(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.get_effective_plan_code_for_user(p_user_id);
end;
$$;

revoke all on function public.backtest_get_plan_code_for_user(uuid) from public, anon, authenticated;
grant execute on function public.backtest_get_plan_code_for_user(uuid) to service_role;

commit;
