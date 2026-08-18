-- Phase 1B: only Founder/owner, Sales, and Compliance may use Marketplace Lab.
-- Eligibility and licensing boundary. This migration is pending only: it does
-- not alter active-strategy authority or make any marketplace release public.
alter table public.marketplace_strategy_releases
 add column if not exists source_type text not null default 'CUSTOMER_BETA' check (source_type in ('INTERNAL_TRADE_POLICE','CUSTOMER_BETA')),
 add column if not exists minimum_observation_days integer not null default 180 check (minimum_observation_days >= 180),
 add column if not exists eligibility_status text not null default 'PRIVATE' check (eligibility_status in ('PRIVATE','OBSERVING','INSUFFICIENT_DATA','QUALIFIED','NOT_QUALIFIED','OWNER_CONSENT_PENDING','OWNER_DECLINED','UNDER_REVIEW','APPROVED','LISTED','ELIGIBILITY_WAIVED')),
 add column if not exists ip_owner_user_id uuid references auth.users(id) on delete restrict,
 add column if not exists observation_started_at timestamptz,
 add column if not exists owner_consent_at timestamptz,
 add column if not exists owner_consent_version text,
 add column if not exists eligibility_waiver_reason text,
 add column if not exists eligibility_waived_by uuid references auth.users(id) on delete restrict,
 add column if not exists eligibility_waived_at timestamptz;
update public.marketplace_strategy_releases set ip_owner_user_id=creator_user_id where ip_owner_user_id is null;
alter table public.marketplace_strategy_releases alter column ip_owner_user_id set not null;
alter table public.marketplace_strategy_releases
 add constraint marketplace_internal_waiver_only check (
   (eligibility_status='ELIGIBILITY_WAIVED' and source_type='INTERNAL_TRADE_POLICE' and eligibility_waiver_reason='INTERNAL_TESTING' and eligibility_waived_by is not null and eligibility_waived_at is not null)
   or (eligibility_status<>'ELIGIBILITY_WAIVED' and eligibility_waiver_reason is null and eligibility_waived_by is null and eligibility_waived_at is null)
 );
comment on table public.marketplace_strategy_releases is 'Private by default. Scores may qualify only; publication always requires 180-day observation, sufficient verified data, owner consent, and internal review. INTERNAL_TRADE_POLICE waivers are Lab-only and can never satisfy public eligibility.';

create or replace function public.grant_internal_marketplace_eligibility_waiver(p_release_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_owner() then raise exception 'Founder permission required for internal eligibility waiver'; end if;
 update public.marketplace_strategy_releases set source_type='INTERNAL_TRADE_POLICE',eligibility_status='ELIGIBILITY_WAIVED',eligibility_waiver_reason='INTERNAL_TESTING',eligibility_waived_by=auth.uid(),eligibility_waived_at=now() where id=p_release_id;
 if not found then raise exception 'Marketplace release not found'; end if;
end;$$;

create or replace function public.has_marketplace_lab_access() returns boolean language sql stable security definer set search_path=public as $$
 select public.is_owner() or public.has_staff_permission('sales.view') or public.has_staff_permission('compliance.view')
$$;

create or replace function public.staff_marketplace_simulate_install(p_listing_id uuid,p_recipient_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare l public.marketplace_listings%rowtype;r public.marketplace_strategy_releases%rowtype;i public.marketplace_installs%rowtype;new_strategy uuid;
begin
 if not public.has_marketplace_lab_access() then raise exception 'Marketplace Lab permission denied'; end if;
 select * into l from public.marketplace_listings where id=p_listing_id and visibility='INTERNAL' and review_status='APPROVED' for update;
 if not found then raise exception 'Internal approved listing not found'; end if;
 if not exists(select 1 from auth.users where id=p_recipient_user_id) then raise exception 'Recipient not found'; end if;
 select * into r from public.marketplace_strategy_releases where id=l.release_id and source_type='INTERNAL_TRADE_POLICE' and eligibility_status='ELIGIBILITY_WAIVED';
 if not found then raise exception 'Only INTERNAL TEST releases may use cloned simulated installs'; end if;
 if exists(select 1 from public.marketplace_installs where release_id=r.id and installer_user_id=p_recipient_user_id) then raise exception 'Release already installed for this recipient'; end if;
 insert into public.marketplace_installs(release_id,installer_user_id,entitlement_mode,charged_cents,status) values(r.id,p_recipient_user_id,'SIMULATED_INTERNAL',0,'INSTALLED') returning * into i;
 insert into public.strategy_profiles(user_id,name,is_default,market_types,instruments,trend_timeframe,confirmation_timeframe,entry_timeframe,macro_timeframe,trigger_timeframe,minimum_rr,maximum_risk_percent,allowed_sessions,evidence_weights,required_evidence,stop_limits,marketplace_source_release_id,marketplace_install_id)
 select p_recipient_user_id,coalesce(nullif(r.snapshot_json#>>'{profile,name}',''),'Installed strategy'),false,coalesce(array(select jsonb_array_elements_text(r.snapshot_json#>'{profile,market_types}')),array[]::text[]),coalesce(array(select jsonb_array_elements_text(r.snapshot_json#>'{profile,instruments}')),array[]::text[]),coalesce(r.snapshot_json#>>'{profile,trend_timeframe}',''),coalesce(r.snapshot_json#>>'{profile,confirmation_timeframe}',''),coalesce(r.snapshot_json#>>'{profile,entry_timeframe}',''),nullif(r.snapshot_json#>>'{profile,macro_timeframe}',''),nullif(r.snapshot_json#>>'{profile,trigger_timeframe}',''),coalesce((r.snapshot_json#>>'{profile,minimum_rr}')::numeric,0),coalesce((r.snapshot_json#>>'{profile,maximum_risk_percent}')::numeric,0),coalesce(array(select jsonb_array_elements_text(r.snapshot_json#>'{profile,allowed_sessions}')),array[]::text[]),coalesce(r.snapshot_json#>'{profile,evidence_weights}','{}'::jsonb),coalesce(array(select jsonb_array_elements_text(r.snapshot_json#>'{profile,required_evidence}')),array[]::text[]),coalesce(r.snapshot_json#>'{profile,stop_limits}','{}'::jsonb),r.id,i.id returning id into new_strategy;
 insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled)
 select new_strategy,p_recipient_user_id,x.symbol,x.market_type,x.provider_symbol,x.sort_order,x.enabled
 from jsonb_to_recordset(coalesce(r.snapshot_json->'instruments','[]'::jsonb))
   as x(symbol text,market_type text,provider_symbol text,sort_order integer,enabled boolean);
 insert into public.strategy_sessions(strategy_id,user_id,session_code,name,timezone,start_time,end_time,days,allow_open_outside,allow_hold_outside,is_custom)
 select new_strategy,p_recipient_user_id,x.session_code,x.name,x.timezone,x.start_time::time,x.end_time::time,x.days,x.allow_open_outside,x.allow_hold_outside,x.is_custom
 from jsonb_to_recordset(coalesce(r.snapshot_json->'sessions','[]'::jsonb))
   as x(session_code text,name text,timezone text,start_time text,end_time text,days smallint[],allow_open_outside boolean,allow_hold_outside boolean,is_custom boolean);
 insert into public.strategy_rules(strategy_id,user_id,rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,configuration,sort_order,evaluation_mode)
 select new_strategy,p_recipient_user_id,x.rule_key,x.label,x.enabled,x.mandatory,x.weight,x.minimum_confidence,x.timeframe_role,coalesce(x.configuration,'{}'::jsonb),x.sort_order,coalesce(x.evaluation_mode,'AUTOMATIC')
 from jsonb_to_recordset(coalesce(r.snapshot_json->'rules','[]'::jsonb))
   as x(rule_key text,label text,enabled boolean,mandatory boolean,weight numeric,minimum_confidence integer,timeframe_role text,configuration jsonb,sort_order integer,evaluation_mode text);
 insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier,configuration)
 select new_strategy,p_recipient_user_id,x.instrument,x.method,x.minimum_value,x.preferred_value,x.maximum_value,x.atr_multiplier,coalesce(x.configuration,'{}'::jsonb)
 from jsonb_to_recordset(coalesce(r.snapshot_json->'stopLimits','[]'::jsonb))
   as x(instrument text,method text,minimum_value numeric,preferred_value numeric,maximum_value numeric,atr_multiplier numeric,configuration jsonb);
 update public.marketplace_installs set installed_strategy_id=new_strategy where id=i.id;
 insert into public.marketplace_review_events(release_id,actor_user_id,actor_scope,event_type,note) values(r.id,auth.uid(),'SYSTEM','SIMULATED_INSTALL',null);
 return jsonb_build_object('installId',i.id,'releaseId',r.id,'installedStrategyId',new_strategy,'chargedCents',0,'entitlementMode','SIMULATED_INTERNAL','active',false,'internalTest',true);
end;$$;
revoke all on function public.has_marketplace_lab_access(),public.staff_marketplace_simulate_install(uuid,uuid),public.grant_internal_marketplace_eligibility_waiver(uuid) from public,anon;
grant execute on function public.has_marketplace_lab_access(),public.staff_marketplace_simulate_install(uuid,uuid),public.grant_internal_marketplace_eligibility_waiver(uuid) to authenticated;
notify pgrst,'reload schema';