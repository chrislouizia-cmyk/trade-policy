-- 113_canonical_marketplace_lab_permission.sql
-- Make Marketplace Lab access a first-class canonical staff permission.
--
-- Intended access:
--   OWNER
--   HEAD_OF_SALES
--   COMPLIANCE_OFFICER
--
-- No application-side or RPC-side derivation from broader permissions.

insert into public.staff_permissions(
  permission_key,
  description,
  sensitive
)
values (
  'marketplace.lab',
  'Access internal Marketplace Lab review and simulation tools',
  true
)
on conflict (permission_key) do update
set
  description = excluded.description,
  sensitive = excluded.sensitive;


insert into public.role_permissions(role, permission_key)
values
  ('OWNER', 'marketplace.lab'),
  ('HEAD_OF_SALES', 'marketplace.lab'),
  ('COMPLIANCE_OFFICER', 'marketplace.lab')
on conflict do nothing;


create or replace function public.has_marketplace_lab_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_staff_permission('marketplace.lab')
$$;

revoke all
on function public.has_marketplace_lab_access()
from public, anon;

grant execute
on function public.has_marketplace_lab_access()
to authenticated;

notify pgrst, 'reload schema';
