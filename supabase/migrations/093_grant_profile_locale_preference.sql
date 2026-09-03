begin;

-- Keep profile writes least-privileged: customers may only persist their locale
-- through the existing own-profile RLS policy. Anonymous visitors receive no
-- write capability.
revoke update (preferred_locale) on table public.profiles from anon;
grant update (preferred_locale) on table public.profiles to authenticated;

commit;
