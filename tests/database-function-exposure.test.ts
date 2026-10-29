import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260929154500_revoke_unsafe_function_execution.sql', import.meta.url),
  'utf8',
);

test('internal trigger functions are not callable by API roles', () => {
  for (const functionName of [
    'handle_new_user',
    'protect_profile_billing_fields',
    'rls_auto_enable',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${functionName}\\(\\)[\\s\\S]*?from public, anon, authenticated`),
    );
  }
});

test('unrelated Sanchita seed function is quarantined without destructive cleanup', () => {
  assert.match(migration, /revoke all on function public\.seed_sanchita_menu_complete\(jsonb, jsonb\)/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.doesNotMatch(migration, /drop (function|table|schema)/i);
});
