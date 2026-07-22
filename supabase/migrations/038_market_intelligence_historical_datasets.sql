-- Research-only immutable historical datasets for Market Intelligence validation.
create table if not exists public.market_intelligence_datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  instrument text not null check (instrument ~ '^[A-Z0-9._/-]{1,30}$'),
  asset_class text not null check (length(trim(asset_class)) between 1 and 40),
  timeframe text not null check (timeframe in ('M1','M3','M5','M15','M30','H1','H2','H4','H6','H8','H12','D1','W1','MN')),
  provider text not null check (length(trim(provider)) between 1 and 80),
  status text not null default 'IMPORTED' check (status in ('IMPORTED','VALIDATED','CERTIFIED','ARCHIVED')),
  candle_count integer not null check (candle_count > 0),
  start_at timestamptz not null,
  end_at timestamptz not null check (end_at > start_at),
  content_hash text not null unique check (length(content_hash) >= 16),
  validation_report jsonb not null check (validation_report->>'valid' = 'true'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  sealed_at timestamptz not null default now(),
  validated_at timestamptz,
  certified_at timestamptz,
  unique (instrument,timeframe,version,content_hash)
);

create table if not exists public.market_intelligence_dataset_candles (
  dataset_id uuid not null references public.market_intelligence_datasets(id) on delete restrict,
  opened_at timestamptz not null,
  closed_at timestamptz not null check (closed_at > opened_at),
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision check (volume is null or volume >= 0),
  complete boolean not null check (complete = true),
  primary key (dataset_id,opened_at),
  check (high >= greatest(open,close,low) and low <= least(open,close,high))
);
create index if not exists market_intelligence_dataset_candles_time_idx on public.market_intelligence_dataset_candles(dataset_id,opened_at);

alter table public.market_intelligence_datasets enable row level security;
alter table public.market_intelligence_dataset_candles enable row level security;

drop policy if exists market_intelligence_datasets_staff_read on public.market_intelligence_datasets;
create policy market_intelligence_datasets_staff_read on public.market_intelligence_datasets for select to authenticated using (public.has_staff_permission('system.health'));
drop policy if exists market_intelligence_dataset_candles_staff_read on public.market_intelligence_dataset_candles;
create policy market_intelligence_dataset_candles_staff_read on public.market_intelligence_dataset_candles for select to authenticated using (public.has_staff_permission('system.health'));

create or replace function public.protect_market_intelligence_dataset() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Sealed historical datasets cannot be deleted'; end if;
  if old.name is distinct from new.name or old.version is distinct from new.version or old.instrument is distinct from new.instrument or old.asset_class is distinct from new.asset_class or old.timeframe is distinct from new.timeframe or old.provider is distinct from new.provider or old.candle_count is distinct from new.candle_count or old.start_at is distinct from new.start_at or old.end_at is distinct from new.end_at or old.content_hash is distinct from new.content_hash or old.validation_report is distinct from new.validation_report or old.created_by is distinct from new.created_by or old.created_at is distinct from new.created_at or old.sealed_at is distinct from new.sealed_at then raise exception 'Historical dataset metadata is immutable'; end if;
  if not ((old.status='IMPORTED' and new.status='VALIDATED') or (old.status='VALIDATED' and new.status='CERTIFIED') or (old.status<>'ARCHIVED' and new.status='ARCHIVED')) then raise exception 'Invalid historical dataset certification transition: % to %',old.status,new.status; end if;
  return new;
end;$$;
drop trigger if exists protect_market_intelligence_dataset_trigger on public.market_intelligence_datasets;
create trigger protect_market_intelligence_dataset_trigger before update or delete on public.market_intelligence_datasets for each row execute function public.protect_market_intelligence_dataset();

create or replace function public.protect_market_intelligence_candle() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Sealed historical dataset candles are immutable'; end;$$;
drop trigger if exists protect_market_intelligence_candle_trigger on public.market_intelligence_dataset_candles;
create trigger protect_market_intelligence_candle_trigger before update or delete on public.market_intelligence_dataset_candles for each row execute function public.protect_market_intelligence_candle();

create or replace function public.staff_import_market_intelligence_dataset(p_manifest jsonb,p_candles jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_row public.market_intelligence_datasets%rowtype;v_count integer;v_min timestamptz;v_max timestamptz;
begin
  if auth.uid() is null or not public.has_staff_permission('system.health') then raise exception 'Historical dataset permission denied'; end if;
  if jsonb_typeof(p_manifest)<>'object' or jsonb_typeof(p_candles)<>'array' then raise exception 'Historical dataset payload is invalid'; end if;
  v_count=jsonb_array_length(p_candles);if v_count<1 or v_count>100000 then raise exception 'Historical dataset must contain 1 to 100000 candles';end if;
  select id into v_id from public.market_intelligence_datasets where content_hash=p_manifest->>'contentHash';
  if v_id is not null then select * into v_row from public.market_intelligence_datasets where id=v_id;return to_jsonb(v_row);end if;
  insert into public.market_intelligence_datasets(name,version,instrument,asset_class,timeframe,provider,status,candle_count,start_at,end_at,content_hash,validation_report,created_by,sealed_at) values(trim(p_manifest->>'name'),p_manifest->>'version',upper(trim(p_manifest->>'instrument')),upper(trim(p_manifest->>'assetClass')),p_manifest->>'timeframe',trim(p_manifest->>'provider'),'IMPORTED',v_count,(p_manifest->>'startAt')::timestamptz,(p_manifest->>'endAt')::timestamptz,p_manifest->>'contentHash',p_manifest->'validationReport',auth.uid(),now()) returning id into v_id;
  insert into public.market_intelligence_dataset_candles(dataset_id,opened_at,closed_at,open,high,low,close,volume,complete) select v_id,n.opened_at,n.closed_at,x.open,x.high,x.low,x.close,x.volume,x.complete from jsonb_to_recordset(p_candles) as x("openedAt" timestamptz,"closedAt" timestamptz,open double precision,high double precision,low double precision,close double precision,volume double precision,complete boolean),lateral(select x."openedAt" opened_at,x."closedAt" closed_at) n;
  select count(*),min(opened_at),max(closed_at) into v_count,v_min,v_max from public.market_intelligence_dataset_candles where dataset_id=v_id;
  if v_count<>(p_manifest->>'candleCount')::integer or v_min<>(p_manifest->>'startAt')::timestamptz or v_max<>(p_manifest->>'endAt')::timestamptz then raise exception 'Historical dataset manifest does not match imported candles';end if;
  select * into v_row from public.market_intelligence_datasets where id=v_id;return to_jsonb(v_row);
end;$$;

create or replace function public.staff_transition_market_intelligence_dataset(p_dataset_id uuid,p_target_status text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.market_intelligence_datasets%rowtype;
begin
  if auth.uid() is null or not public.has_staff_permission('system.health') then raise exception 'Historical dataset permission denied';end if;
  if p_target_status not in ('VALIDATED','CERTIFIED','ARCHIVED') then raise exception 'Invalid target dataset status';end if;
  select * into v_row from public.market_intelligence_datasets where id=p_dataset_id for update;
  if v_row.id is null then raise exception 'Historical dataset not found';end if;
  update public.market_intelligence_datasets set status=p_target_status,validated_at=case when p_target_status='VALIDATED' then now() else validated_at end,certified_at=case when p_target_status='CERTIFIED' then now() else certified_at end where id=p_dataset_id returning * into v_row;
  return to_jsonb(v_row);
end;$$;

revoke all on public.market_intelligence_datasets,public.market_intelligence_dataset_candles from public,anon;
grant select on public.market_intelligence_datasets,public.market_intelligence_dataset_candles to authenticated;
revoke all on function public.staff_import_market_intelligence_dataset(jsonb,jsonb),public.staff_transition_market_intelligence_dataset(uuid,text) from public,anon;
grant execute on function public.staff_import_market_intelligence_dataset(jsonb,jsonb),public.staff_transition_market_intelligence_dataset(uuid,text) to authenticated;
