-- Marketplace HQ authority boundary.
-- Customer/staff JWT remains the source of identity.
-- Service-role implementation functions remain internal implementation details.

create or replace function public.staff_create_internal_marketplace_release_v2(
  p_strategy_profile_id uuid,
  p_source_strategy_revision_id text,
  p_canonical_strategy_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_staff_permission('marketplace.lab') then
    raise exception 'Marketplace Lab permission denied';
  end if;

  if not public.is_owner() then
    raise exception 'Founder permission required for internal marketplace release creation';
  end if;

  return public.create_internal_marketplace_release_v1(
    p_strategy_profile_id,
    p_source_strategy_revision_id,
    p_canonical_strategy_text
  );
end;
$$;

revoke all on function public.staff_create_internal_marketplace_release_v2(uuid,text,text)
  from public, anon;

grant execute on function public.staff_create_internal_marketplace_release_v2(uuid,text,text)
  to authenticated;


create or replace function public.staff_review_marketplace_listing_v1(
  p_listing_id uuid,
  p_review_status text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_staff_permission('marketplace.lab') then
    raise exception 'Marketplace Lab permission denied';
  end if;

  if not public.has_staff_permission('compliance.manage') then
    raise exception 'Marketplace review management permission denied';
  end if;

  return public.staff_marketplace_transition_listing(
    p_listing_id,
    p_review_status,
    p_note,
    auth.uid()
  );
end;
$$;

revoke all on function public.staff_review_marketplace_listing_v1(uuid,text,text)
  from public, anon;

grant execute on function public.staff_review_marketplace_listing_v1(uuid,text,text)
  to authenticated;

-- The original creation primitive is implementation-only from this point forward.
revoke execute on function public.create_internal_marketplace_release_v1(uuid,text,text)
  from authenticated;

notify pgrst, 'reload schema';
