import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('customer signup never exposes an empty JSON error and redirects an immediate session', () => {
  const form = read('components/ClientLoginForm.tsx');
  assert.match(form, /raw !== '\{\}'/);
  assert.match(form, /CUSTOMER_SIGNUP_FAILED/);
  assert.match(form, /data\.session/);
  assert.match(form, /window\.location\.assign\('\/onboarding'\)/);
});

test('customer signup trigger is repaired idempotently', () => {
  const migration = read('supabase/migrations/085_repair_customer_signup.sql');
  assert.match(migration, /create or replace function public\.handle_new_user/);
  assert.match(migration, /on conflict \(id\) do update/);
  assert.match(migration, /drop trigger if exists on_auth_user_created/);
  assert.match(migration, /create trigger on_auth_user_created/);
});
