-- Keep a per-user timezone stable across devices. The next app release handles
-- first-device capture and explicit owner-confirmed changes with existing RLS.
alter table public.trader_intelligence_profiles
  add column timezone_source text not null default 'UNSET'
  check (timezone_source in ('UNSET','DEVICE','USER'));
update public.trader_intelligence_profiles set timezone_source='DEVICE'
  where last_seen_at is not null or timezone <> 'UTC';
comment on column public.trader_intelligence_profiles.timezone_source is
  'UNSET: first device may initialize; DEVICE: detected once; USER: explicitly confirmed. Later device signals must not overwrite a saved zone.';
