import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/056_marketplace_service_role_strategy_profile_read.sql', import.meta.url),
  'utf8'
);

test('service-role gets the minimum strategy_profiles read grant without widening customer access', () => {
  assert.match(migration, /grant select on table public\.strategy_profiles to service_role;/i);
  assert.doesNotMatch(migration, /grant\s+select\s+on\s+table\s+public\.strategy_profiles\s+to\s+(authenticated|anon|public)\s*;/i);
  assert.doesNotMatch(migration, /grant\s+select\s+.*public\.strategy_profiles.*to\s+(authenticated|anon|public)\s*;/i);
});
