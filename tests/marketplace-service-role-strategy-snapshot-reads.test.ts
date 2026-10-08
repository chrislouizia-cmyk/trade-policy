import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/059_marketplace_service_role_strategy_snapshot_reads.sql', import.meta.url),
  'utf8'
);

const targetTables = [
  'public.strategy_sessions',
  'public.strategy_rules',
  'public.strategy_stop_limits'
];

test('service-role gets SELECT on exactly the required strategy snapshot tables and no customer roles do', () => {
  for (const table of targetTables) {
    assert.match(migration, new RegExp(`grant select on table ${table.replace('.', '\\.') } to service_role;`, 'i'));
  }

  const serviceRoleGrantCount = (migration.match(/grant\s+select\s+on\s+table\s+public\.[a-z0-9_]+\s+to\s+service_role;/gi) ?? []).length;
  assert.equal(serviceRoleGrantCount, 3);

  for (const role of ['anon', 'authenticated', 'public']) {
    for (const table of targetTables) {
      assert.doesNotMatch(migration, new RegExp(`grant select on table ${table.replace('.', '\\.') } to ${role};`, 'i'));
    }
  }

  assert.doesNotMatch(migration, /grant\s+select\s+on\s+table\s+public\.(?!strategy_sessions|strategy_rules|strategy_stop_limits)[a-z0-9_]+\s+to\s+service_role;/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+table\s+public\.(?!strategy_sessions|strategy_rules|strategy_stop_limits)[a-z0-9_]+\s+to\s+(anon|authenticated|public);/i);
  assert.doesNotMatch(migration, /alter table|enable row level security|disable row level security|create policy|drop policy|revoke.*(anon|authenticated|public)/i);
});
