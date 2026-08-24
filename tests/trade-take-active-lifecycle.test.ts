import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route=readFileSync(new URL('../app/api/trades/take/route.ts',import.meta.url),'utf8');
const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/066_trade_take_anyway_override_metadata.sql',import.meta.url),'utf8');
const rpcMigration=readFileSync(new URL('../supabase/migrations/069_trade_activation_atomic_rpc.sql',import.meta.url),'utf8');

test('override activation returns a persisted trade together with explicit ACTIVE lifecycle confirmation',()=>{
  assert.match(route,/trade:\s*\{\s*id:\s*activation\.active_trade_id\s*\}/);
  assert.match(route,/lifecycleStatus:\s*activation\.lifecycle_status \?\? decisionCheck\.status/);
  assert.match(route,/activeTradeCreated:\s*activation\.active_trade_created === true/);
  assert.match(route,/tradeRecordId:\s*activation\.trade_record_id/);
});

test('activation rpc enforces real database idempotency and removes the fake idempotency parameter',()=>{
  assert.match(route,/const admin = createAdminClient\(\);[\s\S]*admin\.rpc\('activate_trade_atomically_v1'/);
  assert.doesNotMatch(route,/p_idempotency_key|idempotencyKey/i);
  assert.match(rpcMigration,/create unique index if not exists active_trades_user_source_decision_unique/i);
  assert.match(rpcMigration,/where source_decision_id is not null/i);
  assert.match(rpcMigration,/The API route authenticates the caller and passes the validated user_id to the server-owned activation boundary/i);
  assert.doesNotMatch(rpcMigration,/p_idempotency_key|idempotencyKey/i);
  assert.doesNotMatch(rpcMigration,/auth\.uid\(\)\s+is null or p_user_id\s*<>\s*auth\.uid\(\)/i);
});

test('client closes and navigates only after the API confirms that an ACTIVE trade exists',()=>{
  assert.match(validator,/if\(!activation\|\|typeof activation\.trade\?\.id!=='string'\|\|activation\.lifecycleStatus!=='ACTIVE'\|\|activation\.activeTradeCreated!==true\)/);
  assert.match(validator,/closeTradeActionModal\(\);\s*if\(isOverride\)\s*setOverrideConfirmation/);
  assert.match(validator,/window\.location\.assign\('\/active-trade'\)/);
});

test('duplicate protection remains enforced in both client and server paths',()=>{
  assert.match(validator,/if\(tradeSubmissionRef\.current\)return/);
  assert.match(route,/You already have an open trade for this instrument\./);
  assert.match(route,/code==='23505'/);
  assert.match(route,/if \(existing\) \{/);
});

test('activation rpc is not exposed to authenticated clients',()=>{
  assert.match(rpcMigration,/revoke all on function public\.activate_trade_atomically_v1\(/);
  assert.match(rpcMigration,/grant execute on function public\.activate_trade_atomically_v1\(/);
  assert.match(rpcMigration,/to service_role/i);
  assert.doesNotMatch(rpcMigration,/to authenticated/i);
});

test('override trades persist activation metadata and override conditions for history and analytics',()=>{
  assert.match(migration,/alter table public\.active_trades\s+add column if not exists activation_mode/i);
  assert.match(migration,/alter table public\.active_trades\s+add column if not exists override_conditions/i);
  assert.match(migration,/activation_mode\s+text\s+default\s+'READY'\s+check\s*\(\s*activation_mode\s+in\s*\(\s*'READY'\s*,\s*'OVERRIDE'\s*\)\s*\)/i);
  assert.match(migration,/override_conditions\s+jsonb\s+not null\s+default\s+'\[\]'::jsonb/i);
});
