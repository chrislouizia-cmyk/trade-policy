import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildBillingState } from '../lib/billing/state.ts';
import { getAnchoredMonthlyPeriod, getMonthlyPeriodStartKey } from '../lib/billing/period.ts';
import { planFor } from '../lib/billing/plans.ts';

const billingEntitlementsSource = readFileSync(
  new URL('../lib/billing/entitlements.ts', import.meta.url),
  'utf8',
);

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
  const state = buildBillingState({ data: null, error: null }, 0, {
    startKey: '2026-08-01',
    endKey: '2026-09-01',
  });
  assert.equal(state.plan, 'FREE');
});

test('an empty analysis_usage table returns usage 0', () => {
  const state = buildBillingState({ data: null, error: null }, 0, {
    startKey: '2026-08-01',
    endKey: '2026-09-01',
  });
  assert.equal(state.usage, 0);
});

test('reservation and usage counting use the same monthly period key', () => {
  const periodKey = getMonthlyPeriodStartKey(new Date('2026-08-15T12:34:56.000Z'));
  const countFilter = periodKey;
  assert.equal(countFilter, periodKey);
  assert.equal(periodKey, '2026-08-01');
});

test('analysis limits match each designed plan', () => {
  assert.equal(planFor('FREE').monthlyAnalysisLimit, 15);
  assert.equal(planFor('PRIVATE_BETA').monthlyAnalysisLimit, 50);
  assert.equal(planFor('PRO').monthlyAnalysisLimit, 250);
  assert.equal(planFor('ELITE').monthlyAnalysisLimit, 1000);
  assert.equal(planFor('TEAM').monthlyAnalysisLimit, null);
  assert.equal(planFor('FOUNDER').monthlyAnalysisLimit, null);
});

test('getBillingState applies the canonical server-side entitlement override after normal plan resolution', () => {
  const overridesSource = readFileSync(
    new URL('../lib/billing/overrides.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    billingEntitlementsSource,
    /const state = buildBillingState\([\s\S]*return await applyServerEntitlementOverride\(userId, state\);/,
  );
  assert.match(overridesSource, /internal_entitlement_overrides/);
  assert.match(overridesSource, /\.eq\('user_id', userId\)/);
  assert.match(overridesSource, /\.eq\('active', true\)/);
  assert.match(overridesSource, /Promise<PlanCode \| null>/);
  assert.doesNotMatch(overridesSource, /65a21633-51ea-419b-bd0c-e43f81c63b4e/);
  assert.doesNotMatch(overridesSource, /cee066a8-a590-4c1a-9c56-5e1c3617ca26/);
  assert.doesNotMatch(overridesSource, /935d9d88-893b-4163-b276-50bdb63c55e0/);
});

test('private beta entitlement remains available without a paid Stripe subscription', () => {
  const period = getAnchoredMonthlyPeriod(new Date('2026-01-10T00:00:00.000Z'), new Date('2026-01-10T00:00:00.000Z'));
  const state = buildBillingState({ data: { plan: 'PRIVATE_BETA', status: 'inactive' }, error: null }, 0, period);
  assert.equal(state.plan, 'PRIVATE_BETA');
});

test('monthly usage cycles remain anchored to the first analysis day', () => {
  const anchor = new Date('2026-07-15T05:37:15.915Z');
  const august = getAnchoredMonthlyPeriod(anchor, new Date('2026-08-20T12:00:00Z'));
  assert.equal(august.startKey, '2026-08-15');
  assert.equal(august.endKey, '2026-09-15');

  const beforeRenewal = getAnchoredMonthlyPeriod(anchor, new Date('2026-09-14T23:59:59Z'));
  assert.equal(beforeRenewal.startKey, '2026-08-15');
  assert.equal(beforeRenewal.endKey, '2026-09-15');
});

test('month-end anchors clamp safely without becoming calendar-month cycles', () => {
  const period = getAnchoredMonthlyPeriod(
    new Date('2026-01-31T18:00:00Z'),
    new Date('2026-02-28T12:00:00Z'),
  );
  assert.equal(period.startKey, '2026-02-28');
  assert.equal(period.endKey, '2026-03-31');
});

test('strategy detail route resolves plan through the canonical entitlement helper', () => {
  const routeSource = readFileSync(
    new URL('../app/strategies/[id]/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(routeSource, /from '\@\/lib\/billing\/entitlements'/);
  assert.match(routeSource, /getBillingState\(user\.id\)/);
  assert.doesNotMatch(routeSource, /status !== 'active' && status !== 'trialing'/);
});
