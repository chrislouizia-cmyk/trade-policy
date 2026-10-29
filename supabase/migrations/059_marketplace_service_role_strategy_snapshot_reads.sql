grant select on table public.strategy_sessions to service_role;
grant select on table public.strategy_rules to service_role;
grant select on table public.strategy_stop_limits to service_role;

notify pgrst,'reload schema';
