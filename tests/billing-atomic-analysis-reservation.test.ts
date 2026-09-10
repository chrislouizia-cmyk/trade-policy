import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const entitlements = fs.readFileSync('lib/billing/entitlements.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/106_atomic_monthly_analysis_reservation.sql',
  'utf8',
);

test('analysis reservation is delegated to one atomic database RPC', () => {
  assert.match(entitlements, /\.rpc\('reserve_analysis_usage_atomic'/);
  assert.match(entitlements, /p_user_id:\s*userId/);
  assert.match(entitlements, /p_request_key:\s*requestKey/);
  assert.match(entitlements, /p_period_start:\s*periodKey/);
  assert.match(entitlements, /p_monthly_limit:\s*state\.entitlements\.monthlyAnalysisLimit/);

  const reserveBody =
    entitlements.match(
      /export async function reserveAnalysis[\s\S]*?\n}\n\nexport async function finalizeAnalysis/,
    )?.[0] ?? '';

  assert.doesNotMatch(reserveBody, /\.from\('analysis_usage'\)/);
  assert.doesNotMatch(reserveBody, /count:\s*'exact'/);
});

test('database reservation serializes user-period quota decisions', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /p_user_id::text/);
  assert.match(migration, /p_period_start::text/);
  assert.match(migration, /status in \('RESERVED', 'COMPLETED'\)/);
  assert.match(migration, /v_used >= p_monthly_limit/);
});

test('database reservation preserves request-key idempotency', () => {
  assert.match(migration, /where user_id = p_user_id[\s\S]*request_key = p_request_key/);
  assert.match(migration, /'duplicate', true/);
});

test('atomic reservation is server-only', () => {
  assert.match(
    migration,
    /revoke all on function public\.reserve_analysis_usage_atomic\(uuid, text, date, integer\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.reserve_analysis_usage_atomic\(uuid, text, date, integer\)[\s\S]*to service_role/,
  );
});
