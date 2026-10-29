import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('app/api/trades/take/route.ts', 'utf8');

test('trade activation does not run the production admin privilege probe', () => {
  assert.doesNotMatch(source, /TRADE_ADMIN_PRIVILEGE_PROBE/);
  assert.doesNotMatch(source, /privilegeProbe/);
  assert.doesNotMatch(source, /selectedKeySource/);
});

test('atomic trade activation still uses the server admin boundary', () => {
  assert.match(source, /createAdminClient\(\)/);
  assert.match(source, /admin\.rpc\('activate_trade_atomically_v1'/);
});

test('trade activation does not log service-role key source metadata', () => {
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(source, /VERCEL_GIT_COMMIT_SHA/);
});
