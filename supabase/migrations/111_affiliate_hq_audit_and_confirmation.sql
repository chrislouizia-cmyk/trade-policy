-- 111_affiliate_hq_audit_and_confirmation.sql
-- Repair Affiliate audit fingerprint generation for HQ mutations.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.record_affiliate_audit_event(
  p_entity_type text,
  p_entity_id uuid,
  p_action text,
  p_previous_value jsonb,
  p_new_value jsonb,
  p_administrator_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_occurred_at timestamptz := now();
  v_payload text;
  v_fingerprint text;
begin
  if nullif(trim(p_entity_type), '') is null
     or p_entity_id is null
     or nullif(trim(p_action), '') is null
     or nullif(trim(p_reason), '') is null
  then
    raise exception 'INVALID_AFFILIATE_AUDIT_EVENT';
  end if;

  v_payload :=
    concat_ws(
      '|',
      v_id::text,
      trim(p_entity_type),
      p_entity_id::text,
      trim(p_action),
      coalesce(p_previous_value::text, 'null'),
      coalesce(p_new_value::text, 'null'),
      coalesce(p_administrator_id::text, 'system'),
      trim(p_reason),
      v_occurred_at::text
    );

  v_fingerprint :=
    encode(
      extensions.digest(
        convert_to(v_payload, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

  insert into public.affiliate_audit_events(
    id,
    entity_type,
    entity_id,
    action,
    previous_value,
    new_value,
    administrator_id,
    reason,
    occurred_at,
    audit_fingerprint
  )
  values (
    v_id,
    trim(p_entity_type),
    p_entity_id,
    trim(p_action),
    p_previous_value,
    p_new_value,
    p_administrator_id,
    trim(p_reason),
    v_occurred_at,
    v_fingerprint
  );

  return v_id;
end;
$$;

revoke all on function public.record_affiliate_audit_event(
  text, uuid, text, jsonb, jsonb, uuid, text
)
from public, anon, authenticated;

grant execute on function public.record_affiliate_audit_event(
  text, uuid, text, jsonb, jsonb, uuid, text
)
to service_role;

-- staff_review_affiliate calls this function internally as SECURITY DEFINER.
