import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/072_trade_activation_stage_diagnostics.sql', import.meta.url), 'utf8');
const rpcMigration = readFileSync(new URL('../supabase/migrations/069_trade_activation_atomic_rpc.sql', import.meta.url), 'utf8');

const stages = [
  'STAGE_01_ACCOUNT_VALIDATION',
  'STAGE_02_STRATEGY_VALIDATION',
  'STAGE_03_DECISION_VALIDATION',
  'STAGE_04_REPORT_VALIDATION',
  'STAGE_05_LINEAGE_VALIDATION',
  'STAGE_06_EXISTING_DECISION_ACTIVE_TRADE_SELECT',
  'STAGE_07_OPEN_INSTRUMENT_ACTIVE_TRADE_SELECT',
  'STAGE_08_TRADE_RECORD_INSERT',
  'STAGE_09_ACTIVE_TRADE_INSERT',
  'STAGE_10_ACTIVE_TRADE_EVENT_INSERT',
  'STAGE_11_UNIQUE_VIOLATION_RECOVERY_SELECT',
] as const;

test('072 preserves the function security mode and execute ACL shape', () => {
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /revoke all on function public\.activate_trade_atomically_v1\(/i);
  assert.match(migration, /grant execute on function public\.activate_trade_atomically_v1\(/i);
  assert.match(migration, /to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.activate_trade_atomically_v1\([\s\S]*?to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.activate_trade_atomically_v1\([\s\S]*?to public/i);
});

test('072 keeps the unique-violation idempotency recovery path intact', () => {
  assert.match(migration, /exception when unique_violation then/i);
  assert.match(migration, /STAGE_11_UNIQUE_VIOLATION_RECOVERY_SELECT/i);
  assert.match(migration, /return jsonb_build_object\(/i);
});

test('072 tags each major activation stage with a diagnostic marker', () => {
  for (const stage of stages) {
    assert.match(migration, new RegExp(stage, 'i'));
  }
});

test('072 keeps the function signature and service-role grant contract aligned with the original RPC', () => {
  assert.match(rpcMigration, /create or replace function public\.activate_trade_atomically_v1\(/i);
  assert.match(migration, /create or replace function public\.activate_trade_atomically_v1\(/i);
  assert.match(migration, /grant execute on function public\.activate_trade_atomically_v1\(/i);
  assert.match(migration, /to service_role/i);
  assert.doesNotMatch(migration, /grant all on function public\.activate_trade_atomically_v1/i);
  assert.doesNotMatch(migration, /security definer/i);
});
