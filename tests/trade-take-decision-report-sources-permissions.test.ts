import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/067_trade_take_decision_report_sources_permissions.sql', import.meta.url),
  'utf8',
);

test('authenticated has only the SELECT privilege needed for source validation', () => {
  assert.match(migration, /grant select\s+on table public\.decision_report_sources\s+to authenticated;/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|truncate|all)\s+on table public\.decision_report_sources\s+to authenticated;/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|truncate|all)\s+on table public\.decision_report_sources\s+to public;/i);
});

test('RLS remains enabled and the authenticated policy is owner-scoped', () => {
  assert.doesNotMatch(migration, /alter table public\.decision_report_sources disable row level security/i);
  assert.doesNotMatch(migration, /alter table public\.decision_report_sources enable row level security/i);
  assert.match(migration, /create policy "decision report sources select own"\s*on public\.decision_report_sources\s*for select to authenticated\s*using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.doesNotMatch(migration, /using \(true\)/i);
  assert.doesNotMatch(migration, /with check \(true\)/i);
  assert.doesNotMatch(migration, /drop policy/i);
});

test('policy and grant are scoped to owner-read only with no write privileges', () => {
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete|truncate|references|trigger)\b/i);
  assert.doesNotMatch(migration, /grant\s+all\s+on table public\.decision_report_sources/i);
  assert.doesNotMatch(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/i);
});
