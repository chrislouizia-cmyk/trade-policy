import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('internal market access is entitlement-derived with an explicit emergency kill switch', () => {
  const access = read('lib/server/instrument-access.ts');
  assert.match(access, /TWELVE_DATA_INTERNAL_TEST_DISABLED/);
  assert.match(access, /disabledValue !== 'true'/);
  assert.match(access, /has_internal_market_test_access/);
  assert.match(access, /authorized === true/);
  assert.doesNotMatch(access, /TWELVE_DATA_INTERNAL_TEST_ENABLED/);
  assert.doesNotMatch(access, /user_metadata|raw_user_meta_data/);
});

test('catalog sync uses the same internal-testing switch as request authorization', () => {
  const sync = read('lib/server/instrument-catalog-sync.ts');
  assert.match(sync, /isInternalMarketTestingEnabled/);
  assert.doesNotMatch(sync, /TWELVE_DATA_INTERNAL_TEST_ENABLED === 'true'/);
});

test('client test entitlement is isolated from staff access and protected server-side', () => {
  const migration = read('supabase/migrations/20260929123000_internal_market_testers.sql');
  assert.match(migration, /internal_market_testers/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on table public\.internal_market_testers from public, anon, authenticated/);
  assert.match(migration, /auth\.uid\(\) is not null/);
  assert.match(migration, /tester\.user_id = auth\.uid\(\)/);
  assert.match(migration, /or public\.current_staff_role\(\) is not null/);
  assert.match(migration, /revoke all on function public\.has_internal_market_test_access\(\) from public, anon/);
  assert.match(migration, /grant execute on function public\.has_internal_market_test_access\(\) to authenticated/);
});

test('sensitive market and strategy routes enforce catalog access on the server', () => {
  for (const path of [
    'app/api/market/analyze/route.ts',
    'app/api/market/candles/route.ts',
    'app/api/market/quote/route.ts',
    'app/api/backtests/route.ts',
    'app/api/strategies/save/route.ts',
    'app/api/strategy-copilot/route.ts',
  ]) {
    const source = read(path);
    assert.match(source, /resolveInstrumentAccessContext/);
    assert.match(source, /canUseInstrument/);
  }
});

test('catalog RLS hides internal-test instruments from unauthorized users', () => {
  const migration = read('supabase/migrations/20260929123000_internal_market_testers.sql');
  assert.match(migration, /metadata->>'availability' = 'INTERNAL_TEST_ONLY'/);
  assert.match(migration, /has_internal_market_test_access\(\)/);
  assert.match(migration, /metadata->>'availability' = 'AVAILABLE'/);
});
