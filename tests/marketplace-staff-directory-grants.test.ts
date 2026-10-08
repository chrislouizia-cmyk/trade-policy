import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const grantMigration = readFileSync(
  new URL('../supabase/migrations/055_marketplace_staff_directory_service_role_read.sql', import.meta.url),
  'utf8'
);

test('forward-only service-role grant is limited to staff_roles and does not widen other roles', () => {
  assert.match(grantMigration, /grant select on table public\.staff_roles to service_role;/i);
  assert.doesNotMatch(grantMigration, /grant\s+select\s+on\s+table\s+public\.staff_roles\s+to\s+(authenticated|anon|public)\s*;/i);
  assert.doesNotMatch(grantMigration, /grant\s+select\s+.*public\.staff_roles.*to\s+(authenticated|anon|public)\s*;/i);
});
