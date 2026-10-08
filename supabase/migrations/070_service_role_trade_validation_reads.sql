-- Minimal service-role read grants required by the atomic activation ownership and lineage checks.
-- This is additive and intentionally does not broaden the activation boundary beyond the read-only validation path.

grant select on public.trading_accounts to service_role;
grant select on public.strategy_profiles to service_role;
grant select on public.decision_report_sources to service_role;
grant select on public.decision_reports to service_role;

notify pgrst, 'reload schema';
