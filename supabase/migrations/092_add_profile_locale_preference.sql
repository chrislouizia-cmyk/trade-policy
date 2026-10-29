begin;

alter table public.profiles
  add column if not exists preferred_locale text not null default 'auto';

alter table public.profiles
  drop constraint if exists profiles_preferred_locale_check;

alter table public.profiles
  add constraint profiles_preferred_locale_check
  check (preferred_locale in ('auto', 'en', 'es', 'fr'));

comment on column public.profiles.preferred_locale is
  'Customer UI language preference. Auto follows the browser language; no trading logic depends on this value.';

commit;
