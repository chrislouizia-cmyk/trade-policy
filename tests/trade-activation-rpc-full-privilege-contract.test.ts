import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const validationMigration = readFileSync(new URL('../supabase/migrations/070_service_role_trade_validation_reads.sql', import.meta.url), 'utf8');
const activationMigration = readFileSync(new URL('../supabase/migrations/071_service_role_trade_activation_privileges.sql', import.meta.url), 'utf8');
const rpcMigration = readFileSync(new URL('../supabase/migrations/069_trade_activation_atomic_rpc.sql', import.meta.url), 'utf8');

const validationTables = [
  'trading_accounts',
  'strategy_profiles',
  'decision_report_sources',
  'decision_reports',
] as const;

test('070 retains the validation-table read grants needed by the activation RPC', () => {
  for (const table of validationTables) {
    assert.match(validationMigration, new RegExp(`grant select on public\\.${table} to service_role;`, 'i'));
  }
});

test('071 grants only the minimum active-trade lifecycle privileges required by the RPC', () => {
  assert.match(activationMigration, /grant select, insert on public\.active_trades to service_role;/i);
  assert.match(activationMigration, /grant insert on public\.trade_records to service_role;/i);
  assert.match(activationMigration, /grant insert on public\.active_trade_events to service_role;/i);

  assert.doesNotMatch(activationMigration, /grant (update|delete|all) on public\.active_trades to service_role;/i);
  assert.doesNotMatch(activationMigration, /grant (update|delete|all) on public\.trade_records to service_role;/i);
  assert.doesNotMatch(activationMigration, /grant (update|delete|all) on public\.active_trade_events to service_role;/i);
});

test('RPC privilege contract still prevents authenticated callers while keeping the service-role execution boundary', () => {
  assert.match(rpcMigration, /revoke all on function public\.activate_trade_atomically_v1\(/);
  assert.match(rpcMigration, /grant execute on function public\.activate_trade_atomically_v1\(/);
  assert.match(rpcMigration, /to service_role/);
  assert.doesNotMatch(rpcMigration, /to authenticated/);
});

test('the activation RPC does not require update or delete permissions on the lifecycle tables', () => {
  for (const table of ['active_trades', 'trade_records', 'active_trade_events']) {
    assert.doesNotMatch(activationMigration, new RegExp(`grant (update|delete|all) on public\\.${table} to service_role;`, 'i'));
  }
});
