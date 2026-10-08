-- 110_affiliate_hq_management.sql
-- HQ control plane for Affiliate Program.

insert into public.staff_permissions(permission_key, description, sensitive)
values (
  'affiliate.manage',
  'Review and manage Affiliate Program participants',
  true
)
on conflict(permission_key) do update
set description = excluded.description,
    sensitive = excluded.sensitive;

insert into public.role_permissions(role, permission_key)
values ('OWNER', 'affiliate.manage')
on conflict do nothing;


create or replace function public.staff_affiliate_queue(
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text := nullif(upper(trim(coalesce(p_status, ''))), '');
  v_result jsonb;
begin
  if not public.has_staff_permission('affiliate.manage') then
    raise exception 'AFFILIATE_MANAGEMENT_PERMISSION_DENIED';
  end if;

  if v_status is not null
     and v_status not in (
       'PENDING',
       'APPROVED',
       'REJECTED',
       'SUSPENDED',
       'PAUSED',
       'DISABLED'
     )
  then
    raise exception 'INVALID_AFFILIATE_STATUS';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ap.id,
        'user_id', ap.user_id,
        'email', u.email,
        'status', ap.status,
        'referral_code', ap.referral_code,
        'payout_currency', ap.payout_currency,
        'payout_method', ap.payout_method,
        'payout_threshold_minor', ap.payout_threshold_minor,
        'created_at', ap.created_at,
        'updated_at', ap.updated_at,

        'clicks', (
          select count(*)
          from public.affiliate_referral_touches art
          where art.affiliate_id = ap.id
            and art.is_self_referral = false
        ),

        'signups', (
          select count(*)
          from public.affiliate_referrals ar
          where ar.affiliate_id = ap.id
        ),

        'paying_customers', (
          select count(*)
          from public.affiliate_referrals ar
          where ar.affiliate_id = ap.id
            and ar.first_successful_payment_at is not null
        )
      )
      order by
        case ap.status
          when 'PENDING' then 0
          when 'APPROVED' then 1
          when 'SUSPENDED' then 2
          when 'REJECTED' then 3
          else 4
        end,
        ap.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.affiliate_profiles ap
  join auth.users u
    on u.id = ap.user_id
  where v_status is null
     or ap.status = v_status;

  return v_result;
end;
$$;


create or replace function public.staff_review_affiliate(
  p_affiliate_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.affiliate_profiles%rowtype;
  v_decision text := upper(trim(coalesce(p_decision, '')));
  v_new_status text;
  v_reason text :=
    coalesce(
      nullif(trim(coalesce(p_reason, '')), ''),
      'Affiliate status reviewed in HQ.'
    );
begin
  if not public.has_staff_permission('affiliate.manage') then
    raise exception 'AFFILIATE_MANAGEMENT_PERMISSION_DENIED';
  end if;

  if p_affiliate_id is null then
    raise exception 'AFFILIATE_ID_REQUIRED';
  end if;

  select *
  into v_profile
  from public.affiliate_profiles
  where id = p_affiliate_id
  for update;

  if not found then
    raise exception 'AFFILIATE_NOT_FOUND';
  end if;

  case v_decision
    when 'APPROVE' then
      if v_profile.status <> 'PENDING' then
        raise exception 'AFFILIATE_APPROVAL_REQUIRES_PENDING';
      end if;
      v_new_status := 'APPROVED';

    when 'REJECT' then
      if v_profile.status <> 'PENDING' then
        raise exception 'AFFILIATE_REJECTION_REQUIRES_PENDING';
      end if;
      v_new_status := 'REJECTED';

    when 'SUSPEND' then
      if v_profile.status <> 'APPROVED' then
        raise exception 'AFFILIATE_SUSPENSION_REQUIRES_APPROVED';
      end if;
      v_new_status := 'SUSPENDED';

    when 'REACTIVATE' then
      if v_profile.status not in ('SUSPENDED', 'PAUSED') then
        raise exception 'AFFILIATE_REACTIVATION_REQUIRES_SUSPENDED';
      end if;
      v_new_status := 'APPROVED';

    else
      raise exception 'INVALID_AFFILIATE_DECISION';
  end case;

  update public.affiliate_profiles
  set status = v_new_status,
      updated_at = now()
  where id = v_profile.id;

  perform public.record_affiliate_audit_event(
    'affiliate_profile',
    v_profile.id,
    'HQ_' || v_decision,
    jsonb_build_object('status', v_profile.status),
    jsonb_build_object('status', v_new_status),
    auth.uid(),
    v_reason
  );

  return jsonb_build_object(
    'id', v_profile.id,
    'previous_status', v_profile.status,
    'status', v_new_status,
    'decision', v_decision
  );
end;
$$;


revoke all on function public.staff_affiliate_queue(text)
from public, anon;

grant execute on function public.staff_affiliate_queue(text)
to authenticated;

revoke all on function public.staff_review_affiliate(uuid, text, text)
from public, anon;

grant execute on function public.staff_review_affiliate(uuid, text, text)
to authenticated;
