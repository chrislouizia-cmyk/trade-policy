import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('internal market access is staff-derived and controlled by an explicit server flag', () => {
  const access = read('lib/server/instrument-access.ts');
  assert.match(access, /TWELVE_DATA_INTERNAL_TEST_ENABLED/);
  assert.match(access, /current_staff_role/);
  assert.doesNotMatch(access, /user_metadata|raw_user_meta_data/);
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

test('catalog RLS hides internal-test instruments from non-staff users', () => {
  const migration = read('supabase/migrations/20260927143146_universal_instrument_catalog_capabilities.sql');
  assert.match(migration, /metadata->>'availability' = 'INTERNAL_TEST_ONLY'/);
  assert.match(migration, /current_staff_role\(\) is not null/);
  assert.match(migration, /metadata->>'availability' = 'AVAILABLE'/);
});
