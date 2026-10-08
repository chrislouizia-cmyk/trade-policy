import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const migration = fs
  .readFileSync(
    'supabase/migrations/109_affiliate_adjustment_idempotency.sql',
    'utf8',
  )
  .replace(/\s+/g, ' ')
  .toLowerCase();

test('system adjustments no longer require a fake user id', () => {
  assert.match(
    migration,
    /alter column created_by drop not null/,
  );
});

test('refund and chargeback sources have economic idempotency', () => {
  assert.match(
    migration,
    /create unique index if not exists affiliate_adjustments_source_uidx/,
  );

  assert.match(
    migration,
    /source_type, source_id/,
  );
});

test('system adjustment rpc is service-role only', () => {
  assert.match(
    migration,
    /record_affiliate_system_adjustment/,
  );

  assert.match(
    migration,
    /from public, anon, authenticated/,
  );

  assert.match(
    migration,
    /to service_role/,
  );
});

test('adjustments are append-only economic truth', () => {
  assert.match(
    migration,
    /affiliate_adjustment_ledger_append_only/,
  );

  assert.match(
    migration,
    /affiliate_adjustment_economic_truth_immutable/,
  );
});

test('reversal amount is cumulative and proportional to Stripe financial reversal', () => {
  assert.match(
    migration,
    /v_same_type_source_amount \+ p_source_amount_minor/,
  );

  assert.match(
    migration,
    /v_target_adjustment - v_same_type_adjusted/,
  );

  assert.match(
    migration,
    /p_source_total_minor::numeric/,
  );
});

test('total adjustments cannot exceed remaining commission', () => {
  assert.match(
    migration,
    /v_commission\.commission_amount_minor - v_already_adjusted/,
  );

  assert.match(
    migration,
    /least\(/,
  );
});

test('unknown invoice becomes a safe no-op', () => {
  assert.match(
    migration,
    /where stripe_invoice_id = trim\(p_stripe_invoice_id\)/,
  );

  assert.match(
    migration,
    /if not found then return null/,
  );
});

test('partial refunds use cumulative proportional math to avoid rounding drift', () => {
  assert.match(
    migration,
    /v_same_type_source_amount \+ p_source_amount_minor/,
  );

  assert.match(
    migration,
    /v_target_adjustment - v_same_type_adjusted/,
  );
});

test('refund plus chargeback can never reverse more than original commission', () => {
  assert.match(
    migration,
    /v_commission\.commission_amount_minor - v_already_adjusted/,
  );

  assert.match(
    migration,
    /v_adjustment := least/,
  );

  assert.match(
    migration,
    /v_remaining/,
  );
});

test('replayed financial source returns existing adjustment before mutation', () => {
  assert.match(
    migration,
    /where source_type = v_source_type and source_id = trim\(p_source_id\)/,
  );

  assert.match(
    migration,
    /if v_existing_id is not null then return v_existing_id/,
  );
});
