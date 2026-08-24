import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/070_service_role_trade_validation_reads.sql', import.meta.url), 'utf8');
const rpcMigration = readFileSync(new URL('../supabase/migrations/069_trade_activation_atomic_rpc.sql', import.meta.url), 'utf8');

const validationTables = [
  'trading_accounts',
  'strategy_profiles',
  'decision_report_sources',
  'decision_reports',
] as const;

test('service_role has the minimum read grants required by the activation RPC ownership checks', () => {
  for (const table of validationTables) {
    assert.match(migration, new RegExp(`grant select on public\\.${table} to service_role;`, 'i'));
  }
});

test('no unnecessary write grants are added to the validation tables', () => {
  for (const table of validationTables) {
    assert.doesNotMatch(migration, new RegExp(`grant (insert|update|delete|all) on public\\.${table} to service_role;`, 'i'));
  }
});

test('activation RPC remains inaccessible to authenticated and service-role only', () => {
  assert.match(rpcMigration, /revoke all on function public\.activate_trade_atomically_v1\(/);
  assert.match(rpcMigration, /grant execute on function public\.activate_trade_atomically_v1\(/);
  assert.match(rpcMigration, /to service_role/);
  assert.doesNotMatch(rpcMigration, /to authenticated/);
});

test('validation tables remain protected by row-level security and do not become service-side write tables', () => {
  for (const table of validationTables) {
    const tableName = `public.${table}`;
    assert.doesNotMatch(migration, new RegExp(`grant (insert|update|delete|all) on ${tableName.replace('.', '\\.') } to service_role;`, 'i'));
  }
});
