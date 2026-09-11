-- 112_affiliate_customer_rpc_boundary.sql
-- Remove customer-facing service-role shortcuts from Affiliate Account.
--
-- Customer authority:
--   - authenticated user may create only their own affiliate application
--   - authenticated affiliate may inspect only their own click count
--   - no direct customer write access to affiliate tables

create or replace function public.apply_for_affiliate()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_id uuid;
  v_profile_id uuid;
  v_referral_code text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id
  into v_existing_id
  from public.affiliate_profiles
  where user_id = v_user_id
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  -- Deterministic user-owned code. Full UUID payload avoids relying on
  -- privileged randomness or application-supplied identity.
  v_referral_code :=
    'TP' || upper(replace(v_user_id::text, '-', ''));

  insert into public.affiliate_profiles(
    user_id,
    status,
    referral_code
  )
  values (
    v_user_id,
    'PENDING',
    v_referral_code
  )
  on conflict (user_id) do nothing
  returning id into v_profile_id;

  if v_profile_id is null then
    select id
    into v_profile_id
    from public.affiliate_profiles
    where user_id = v_user_id
    limit 1;
  end if;

  return v_profile_id;
end;
$$;

revoke all on function public.apply_for_affiliate()
from public, anon;

grant execute on function public.apply_for_affiliate()
to authenticated;


create or replace function public.affiliate_click_count(
  p_affiliate_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count bigint;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_affiliate_id is null then
    raise exception 'AFFILIATE_ID_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.affiliate_profiles ap
    where ap.id = p_affiliate_id
      and ap.user_id = v_user_id
  ) then
    raise exception 'AFFILIATE_CLICK_COUNT_FORBIDDEN';
  end if;

  select count(*)
  into v_count
  from public.affiliate_referral_touches art
  where art.affiliate_id = p_affiliate_id
    and art.is_active = true
    and art.is_self_referral = false;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.affiliate_click_count(uuid)
from public, anon;

grant execute on function public.affiliate_click_count(uuid)
to authenticated;
