-- Atomic Stripe event processing and verified subscription provenance.
alter table public.billing_subscriptions
  add column if not exists stripe_price_id text,
  add column if not exists stripe_product_id text,
  add column if not exists stripe_subscription_created_at timestamptz;

alter table public.stripe_webhook_events
  add column if not exists livemode boolean not null default false,
  add column if not exists processing_status text not null default 'PROCESSED',
  add column if not exists attempt_count integer not null default 1,
  add column if not exists processing_started_at timestamptz,
  add column if not exists failure_code text;

alter table public.stripe_webhook_events alter column processed_at drop not null;
alter table public.stripe_webhook_events alter column processed_at drop default;

do $$ begin
  alter table public.stripe_webhook_events add constraint stripe_webhook_processing_status_check check(processing_status in('PROCESSING','PROCESSED','FAILED'));
exception when duplicate_object then null; end $$;

create or replace function public.claim_stripe_webhook_event(p_event_id text,p_event_type text,p_stripe_created_at timestamptz,p_livemode boolean)
returns text language plpgsql security definer set search_path=public as $$
declare current_status text;claimed integer;
begin
  insert into public.stripe_webhook_events(event_id,event_type,stripe_created_at,livemode,processing_status,attempt_count,processing_started_at,processed_at,failure_code)
  values(p_event_id,p_event_type,p_stripe_created_at,p_livemode,'PROCESSING',1,now(),null,null)
  on conflict(event_id) do nothing;
  get diagnostics claimed=row_count;
  if claimed=1 then return 'CLAIMED';end if;

  update public.stripe_webhook_events set processing_status='PROCESSING',attempt_count=attempt_count+1,processing_started_at=now(),processed_at=null,failure_code=null
  where event_id=p_event_id and (processing_status='FAILED' or (processing_status='PROCESSING' and processing_started_at<now()-interval '5 minutes'));
  get diagnostics claimed=row_count;
  if claimed=1 then return 'CLAIMED';end if;

  select processing_status into current_status from public.stripe_webhook_events where event_id=p_event_id;
  return coalesce(current_status,'PROCESSING');
end;$$;

revoke all on function public.claim_stripe_webhook_event(text,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.claim_stripe_webhook_event(text,text,timestamptz,boolean) to service_role;
