-- Trade Police V21 — atomic authenticated strategy persistence.

create or replace function public.save_strategy_bundle(
  p_strategy_id uuid,
  p_profile jsonb,
  p_instruments jsonb,
  p_sessions jsonb,
  p_rules jsonb,
  p_stop_limits jsonb,
  p_activate boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_strategy_id uuid;
  v_columns text;
  v_values text;
  v_assignments text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if nullif(trim(p_profile->>'name'), '') is null then raise exception 'Strategy name is required'; end if;

  select
    string_agg(format('%I', key), ', '),
    string_agg(format('incoming.%I', key), ', '),
    string_agg(format('%1$I = incoming.%1$I', key), ', ')
  into v_columns, v_values, v_assignments
  from jsonb_object_keys(p_profile) as keys(key)
  where key not in ('id','user_id','is_default','created_at','updated_at')
    and exists (
      select 1 from pg_attribute
      where attrelid = 'public.strategy_profiles'::regclass
        and attname = key and attnum > 0 and not attisdropped
    );

  if v_columns is null then raise exception 'No strategy fields were supplied'; end if;

  if p_strategy_id is null then
    execute format(
      'insert into public.strategy_profiles (user_id, is_default, %s) select $1, false, %s from jsonb_populate_record(null::public.strategy_profiles, $2) incoming returning id',
      v_columns, v_values
    ) using v_user_id, p_profile into v_strategy_id;
  else
    if not exists (select 1 from public.strategy_profiles where id=p_strategy_id and user_id=v_user_id) then
      raise exception 'Strategy not found or unavailable';
    end if;
    execute format(
      'update public.strategy_profiles target set %s, updated_at=now() from jsonb_populate_record(null::public.strategy_profiles, $1) incoming where target.id=$2 and target.user_id=$3',
      v_assignments
    ) using p_profile, p_strategy_id, v_user_id;
    v_strategy_id := p_strategy_id;
  end if;

  delete from public.strategy_instruments where strategy_id=v_strategy_id and user_id=v_user_id;
  delete from public.strategy_sessions where strategy_id=v_strategy_id and user_id=v_user_id;
  delete from public.strategy_rules where strategy_id=v_strategy_id and user_id=v_user_id;
  delete from public.strategy_stop_limits where strategy_id=v_strategy_id and user_id=v_user_id;

  insert into public.strategy_instruments(strategy_id,user_id,symbol,market_type,provider_symbol,sort_order,enabled)
  select v_strategy_id,v_user_id,x.symbol,x.market_type,x.provider_symbol,x.sort_order,x.enabled
  from jsonb_to_recordset(coalesce(p_instruments,'[]'::jsonb)) as x(symbol text,market_type text,provider_symbol text,sort_order integer,enabled boolean);

  insert into public.strategy_sessions(strategy_id,user_id,session_code,name,timezone,start_time,end_time,days,allow_open_outside,allow_hold_outside,is_custom)
  select v_strategy_id,v_user_id,x.session_code,x.name,x.timezone,x.start_time::time,x.end_time::time,x.days,x.allow_open_outside,x.allow_hold_outside,x.is_custom
  from jsonb_to_recordset(coalesce(p_sessions,'[]'::jsonb)) as x(session_code text,name text,timezone text,start_time text,end_time text,days smallint[],allow_open_outside boolean,allow_hold_outside boolean,is_custom boolean);

  insert into public.strategy_rules(strategy_id,user_id,rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,sort_order)
  select v_strategy_id,v_user_id,x.rule_key,x.label,x.enabled,x.mandatory,x.weight,x.minimum_confidence,x.timeframe_role,x.sort_order
  from jsonb_to_recordset(coalesce(p_rules,'[]'::jsonb)) as x(rule_key text,label text,enabled boolean,mandatory boolean,weight numeric,minimum_confidence integer,timeframe_role text,sort_order integer);

  insert into public.strategy_stop_limits(strategy_id,user_id,instrument,method,minimum_value,preferred_value,maximum_value,atr_multiplier)
  select v_strategy_id,v_user_id,x.instrument,x.method,x.minimum_value,x.preferred_value,x.maximum_value,x.atr_multiplier
  from jsonb_to_recordset(coalesce(p_stop_limits,'[]'::jsonb)) as x(instrument text,method text,minimum_value numeric,preferred_value numeric,maximum_value numeric,atr_multiplier numeric);

  if p_activate then perform public.set_active_strategy(v_strategy_id); end if;

  return jsonb_build_object(
    'strategyId',v_strategy_id,'saved',true,
    'activated',(select is_default from public.strategy_profiles where id=v_strategy_id),
    'instrumentCount',(select count(*) from public.strategy_instruments where strategy_id=v_strategy_id),
    'sessionCount',(select count(*) from public.strategy_sessions where strategy_id=v_strategy_id),
    'ruleCount',(select count(*) from public.strategy_rules where strategy_id=v_strategy_id),
    'stopLimitCount',(select count(*) from public.strategy_stop_limits where strategy_id=v_strategy_id)
  );
end;
$$;

revoke all on function public.save_strategy_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) from public;
grant execute on function public.save_strategy_bundle(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean) to authenticated;
