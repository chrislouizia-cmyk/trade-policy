import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('sign out uses the canonical Supabase client and only redirects after success', () => {
  const button = read('components/SignOutButton.tsx');
  assert.match(button, /createClient\(\)\.auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.match(button, /if \(error\) throw error;[\s\S]*catch[\s\S]*still signed in/);
  assert.match(button, /window\.location\.replace\(loginPath\)/);
  assert.match(button, /\/client\/login\?signedOut=1/);
  assert.match(button, /\/hq\/login\?signedOut=1/);
});

test('protected responses are not cached and unauthenticated traffic uses the correct portal', () => {
  const proxy = read('lib/supabase/proxy.ts');
  assert.match(proxy, /private, no-store, max-age=0/);
  assert.match(proxy, /isStaffPath \? canonicalUrls\.hq : canonicalUrls\.portal/);
  assert.match(proxy, /pathname\.startsWith\('\/hq'\)/);
});

test('HQ authorization remains server enforced', () => {
  const guard = read('lib/hq-page.tsx');
  assert.match(guard, /has_staff_permission/);
  assert.match(guard, /if\(!role\|\|!allowed\)redirect/);
});

test('auth logging excludes cookie names and session values', () => {
  const server = read('lib/supabase/server.ts');
  const proxy = read('lib/supabase/proxy.ts');
  assert.doesNotMatch(`${server}\n${proxy}`, /auth-debug|cookieNames|cookieCount/);
  assert.match(proxy, /Session verification failed/);
});
