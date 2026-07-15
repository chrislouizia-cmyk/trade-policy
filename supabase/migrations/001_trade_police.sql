-- Trade Police v2.3: multi-user foundation
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'trader' check (role in ('trader','admin')),
  plan text not null default 'private_beta' check (plan in ('private_beta','free','pro','team')),
  subscription_status text not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id,email) values (new.id,new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.trade_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('SUGGESTED','EXECUTED')),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  instrument text not null check (instrument in ('XAUUSD','GBPUSD','GBPJPY')),
  direction text not null check (direction in ('BUY','SELL')),
  setup_type text not null,
  session text,
  entry numeric,
  stop_loss numeric,
  take_profit numeric,
  rr numeric,
  score integer,
  verdict text,
  outcome text check (outcome is null or outcome in ('WIN','LOSS','BREAKEVEN','PARTIAL')),
  result_r numeric,
  h4_image_path text,
  h1_image_path text,
  m30_image_path text,
  post_trade_image_path text,
  chart_analysis jsonb,
  post_analysis jsonb,
  rule_snapshot jsonb,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists trade_records_user_created_idx on public.trade_records(user_id,created_at desc);
create index if not exists trade_records_pattern_idx on public.trade_records(user_id,instrument,setup_type,outcome);

create table if not exists public.investigation_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trigger_count integer not null default 5,
  trade_ids uuid[] not null,
  repeated_factors jsonb not null default '[]'::jsonb,
  conclusions text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.trade_records enable row level security;
alter table public.investigation_reviews enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "records_select_own" on public.trade_records for select to authenticated using ((select auth.uid()) = user_id);
create policy "records_insert_own" on public.trade_records for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "records_update_own" on public.trade_records for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "records_delete_own" on public.trade_records for delete to authenticated using ((select auth.uid()) = user_id);
create policy "reviews_select_own" on public.investigation_reviews for select to authenticated using ((select auth.uid()) = user_id);
create policy "reviews_insert_own" on public.investigation_reviews for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "reviews_update_own" on public.investigation_reviews for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('trade-charts','trade-charts',false,8388608,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=false,file_size_limit=8388608;

create policy "chart_upload_own_folder" on storage.objects for insert to authenticated
with check (bucket_id='trade-charts' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "chart_select_own_folder" on storage.objects for select to authenticated
using (bucket_id='trade-charts' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "chart_update_own_folder" on storage.objects for update to authenticated
using (bucket_id='trade-charts' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='trade-charts' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "chart_delete_own_folder" on storage.objects for delete to authenticated
using (bucket_id='trade-charts' and (storage.foldername(name))[1]=(select auth.uid())::text);
