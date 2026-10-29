import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/046_decision_report_sources_service_role_grants.sql', import.meta.url),
  'utf8',
);

test('decision report sources grant only the required server-side table privileges', () => {
  assert.match(
    migration,
    /grant select, insert\s+on table public\.decision_report_sources\s+to service_role;/i,
  );
  assert.doesNotMatch(migration, /\b(update|delete|truncate|references|trigger|all)\b/i);
  assert.doesNotMatch(migration, /\b(anon|authenticated)\b/i);
});

test('decision report source grant does not change row-level security or policies', () => {
  assert.doesNotMatch(migration, /\b(create|alter|drop)\s+policy\b/i);
  assert.doesNotMatch(migration, /\b(enable|disable|force|no force)\s+row level security\b/i);
});
