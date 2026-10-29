import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync('app/account/affiliate/page.tsx', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/112_affiliate_customer_rpc_boundary.sql',
  'utf8'
);

test('customer Affiliate page has no service-role admin client', () => {
  assert.doesNotMatch(page, /createAdminClient/);
  assert.doesNotMatch(page, /affiliate_referral_touches/);
});

test('customer application goes through authenticated self-service RPC', () => {
  assert.match(page, /rpc\('apply_for_affiliate'/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.apply_for_affiliate\(\)\s+to authenticated/i);
});

test('affiliate click count is owner-scoped in the database', () => {
  assert.match(page, /rpc\('affiliate_click_count'/);
  assert.match(migration, /ap\.user_id = v_user_id/);
  assert.match(migration, /art\.affiliate_id = p_affiliate_id/);
});

test('customer RPCs do not restore direct affiliate table writes', () => {
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete).*affiliate_profiles.*authenticated/is);
  assert.doesNotMatch(migration, /grant\s+select.*affiliate_referral_touches.*authenticated/is);
});
