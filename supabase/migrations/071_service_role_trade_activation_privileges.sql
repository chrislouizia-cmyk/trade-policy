-- Minimal service-role privileges required by the atomic activation RPC.
-- The RPC validates ownership against several read-only tables, then writes the activation rows.
-- No UPDATE or DELETE privileges are granted because the function does not use them.

grant select, insert on public.active_trades to service_role;
grant insert on public.trade_records to service_role;
grant insert on public.active_trade_events to service_role;

notify pgrst, 'reload schema';
