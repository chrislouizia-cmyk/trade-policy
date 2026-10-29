import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase/migrations/072_trade_activation_stage_diagnostics.sql', import.meta.url), 'utf8');
const rpcMigration = readFileSync(new URL('../supabase/migrations/069_trade_activation_atomic_rpc.sql', import.meta.url), 'utf8');
const schemaAlignmentMigration = readFileSync(new URL('../supabase/migrations/087_align_atomic_activation_trade_records_schema.sql', import.meta.url), 'utf8');

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

test('087 aligns the atomic RPC trade_records insert with the production schema', () => {
  const tradeRecordsInsert = schemaAlignmentMigration.match(/insert into public\.trade_records\s*\(([\s\S]*?)\)\s*values\s*\(/i)?.[1] ?? '';
  const tradeRecordsValues = schemaAlignmentMigration.match(/values\s*\(([\s\S]*?)\)\s*returning id into v_trade_record_id;/i)?.[1] ?? '';
  const lifecycleOnlyColumns = [
    'strategy_snapshot',
    'original_verdict',
    'original_verdict_reason',
    'taken_against_verdict',
    'override_reason',
    'override_conditions',
    'activation_mode',
    'strategy_revision_id',
    'source_decision_id',
    'source_report_id',
  ];

  assert.match(tradeRecordsInsert, /\brule_snapshot\b/i);
  assert.match(tradeRecordsValues, /\bp_strategy_snapshot\b/i);
  assert.equal((tradeRecordsValues.match(/\bp_strategy_snapshot\b/g) ?? []).length, 1);
  for (const column of lifecycleOnlyColumns) {
    assert.doesNotMatch(tradeRecordsInsert, new RegExp(`\\b${column}\\b`, 'i'));
  }

  assert.match(schemaAlignmentMigration, /insert into public\.active_trades[\s\S]*strategy_snapshot[\s\S]*p_strategy_snapshot/i);
  assert.match(schemaAlignmentMigration, /insert into public\.active_trades[\s\S]*override_reason[\s\S]*p_override_reason/i);
  const activeTradesInsert = schemaAlignmentMigration.match(/insert into public\.active_trades\s*\(([\s\S]*?)\)\s*values\s*\(/i)?.[1] ?? '';
  const activeTradesValues = schemaAlignmentMigration.match(/insert into public\.active_trades\s*\([\s\S]*?\)\s*values\s*\(([\s\S]*?)\)\s*returning id into v_trade_id;/i)?.[1] ?? '';
  assert.doesNotMatch(activeTradesInsert, /\bstrategy_version\b/i);
  assert.doesNotMatch(activeTradesValues, /\bp_strategy_version\b/i);
  assert.match(schemaAlignmentMigration, /ACTIVATION_STAGE=STAGE_08_TRADE_RECORD_INSERT/i);
  assert.match(schemaAlignmentMigration, /ACTIVATION_STAGE=STAGE_09_ACTIVE_TRADE_INSERT/i);
});
