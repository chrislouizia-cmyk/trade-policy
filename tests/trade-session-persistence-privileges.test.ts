import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/091_grant_trade_session_persistence_privileges.sql', import.meta.url),
  'utf8',
).toLowerCase();

const sessionRpc = readFileSync(
  new URL('../supabase/migrations/088_persist_atomic_trade_session.sql', import.meta.url),
  'utf8',
).toLowerCase();

const validator = readFileSync(
  new URL('../components/TradeValidator.tsx', import.meta.url),
  'utf8',
);

test('session persistence grants only its required trade record columns to service_role', () => {
  assert.match(migration, /grant\s+select\s*\(id,\s*user_id,\s*session\)[\s\S]*to\s+service_role/);
  assert.match(migration, /grant\s+update\s*\(session,\s*updated_at\)[\s\S]*to\s+service_role/);
  assert.doesNotMatch(migration, /to\s+(anon|authenticated)\b/);
  assert.doesNotMatch(migration, /grant\s+(all|select|update)\s+on\s+table/);
});

test('session-aware activation remains invoker-scoped', () => {
  assert.match(sessionRpc, /security\s+invoker/);
  assert.doesNotMatch(sessionRpc, /security\s+definer/);
});

test('trade activation UI reads structured public API errors', () => {
  assert.match(
    validator,
    /error:\s*apiErrorMessage\(data,\s*'Trade authorization could not be completed\. Please try again\.'\)/,
  );
});
