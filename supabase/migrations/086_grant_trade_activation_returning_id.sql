-- The atomic activation RPC inserts a trade record with RETURNING id.
-- PostgreSQL requires SELECT privilege on every column referenced by RETURNING,
-- even when the caller already has INSERT on the table.
-- Keep this grant column-scoped so the server role cannot read trade details.

grant select (id) on public.trade_records to service_role;

notify pgrst, 'reload schema';
