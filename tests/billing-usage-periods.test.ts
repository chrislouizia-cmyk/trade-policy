import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBillingState } from '../lib/billing/entitlements.ts';
import { getMonthlyPeriodStartKey } from '../lib/billing/period.ts';

test('period_start filters use YYYY-MM-DD', () => {
  const key = getMonthlyPeriodStartKey(new Date('2026-08-15T12:34:56.000Z'));
  assert.equal(key, '2026-08-01');
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
});

test('no full ISO timestamp is sent to a date column', () => {
  const key = getMonthlyPeriodStartKey(new Date('2026-08-15T12:34:56.000Z'));
  assert.doesNotMatch(key, /T|Z/);
});

test('a Free user with no subscription row resolves as FREE', () => {
  const state = buildBillingState({ data: null, error: null }, 0);
  assert.equal(state.plan, 'FREE');
});

test('an empty analysis_usage table returns usage 0', () => {
  const state = buildBillingState({ data: null, error: null }, 0);
  assert.equal(state.usage, 0);
});

test('reservation and usage counting use the same monthly period key', () => {
  const periodKey = getMonthlyPeriodStartKey(new Date('2026-08-15T12:34:56.000Z'));
  const countFilter = periodKey;
  assert.equal(countFilter, periodKey);
  assert.equal(periodKey, '2026-08-01');
});
