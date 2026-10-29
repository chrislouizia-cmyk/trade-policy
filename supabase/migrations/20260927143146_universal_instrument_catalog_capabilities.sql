alter table public.instrument_catalog
  drop constraint if exists instrument_catalog_market_type_check;

alter table public.instrument_catalog
  add constraint instrument_catalog_market_type_check
  check (market_type in ('FOREX','FUTURES','STOCKS','ETFS','CRYPTO','INDEX','METALS','COMMODITIES'));

alter table public.instrument_catalog
  add column if not exists last_verified_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.instrument_catalog
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'provider', 'TWELVE_DATA',
    'availability', case when is_active then 'INTERNAL_TEST_ONLY' else 'UNVERIFIED' end,
    'capabilities', case
      when is_active then jsonb_build_array('QUOTE','HISTORICAL','BACKTEST','LIVE_ANALYSIS')
      else '[]'::jsonb
    end,
    'licenseTier', 'BASIC_INTERNAL_NON_DISPLAY'
  ),
  last_verified_at = coalesce(last_verified_at, now()),
  updated_at = now()
where market_type in ('FOREX','METALS');

drop policy if exists "instrument_catalog_read" on public.instrument_catalog;
create policy "instrument_catalog_read" on public.instrument_catalog
  for select to authenticated
  using (
    is_active = true
    and (
      metadata->>'availability' = 'AVAILABLE'
      or (
        metadata->>'availability' = 'INTERNAL_TEST_ONLY'
        and public.current_staff_role() is not null
      )
    )
  );

create index if not exists instrument_catalog_active_market_symbol_idx
  on public.instrument_catalog (market_type, symbol)
  where is_active = true;

create index if not exists instrument_catalog_display_name_idx
  on public.instrument_catalog (lower(display_name));

comment on column public.instrument_catalog.metadata is
  'Provider capabilities, licensing status, internal-test access, timezone and synchronization provenance. An active row is not sufficient by itself; application code must check availability, caller authorization and capabilities.';

comment on column public.instrument_catalog.last_verified_at is
  'Most recent successful provider-reference verification for this instrument.';

create or replace function public.search_instrument_catalog(
  p_query text,
  p_market_type text default null,
  p_limit integer default 20
)
returns table (
  symbol text,
  display_name text,
  market_type text,
  category text,
  provider_symbol text,
  exchange text,
  country text,
  base_currency text,
  quote_currency text,
  is_active boolean,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.symbol, i.display_name, i.market_type, i.category, i.provider_symbol,
    i.exchange, i.country, i.base_currency, i.quote_currency, i.is_active, i.metadata
  from public.instrument_catalog i
  where i.is_active = true
    and (p_market_type is null or i.market_type = p_market_type)
    and (
      i.symbol ilike '%' || trim(coalesce(p_query, '')) || '%'
      or i.display_name ilike '%' || trim(coalesce(p_query, '')) || '%'
    )
  order by
    case when i.symbol = upper(trim(coalesce(p_query, ''))) then 0
         when i.symbol like upper(trim(coalesce(p_query, ''))) || '%' then 1
         else 2 end,
    i.symbol
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

grant execute on function public.search_instrument_catalog(text,text,integer) to authenticated;
