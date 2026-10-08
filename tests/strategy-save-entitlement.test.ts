import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { planFor } from '../lib/billing/plans.ts';

const route = readFileSync(new URL('../app/api/strategies/save/route.ts', import.meta.url), 'utf8');

test('Founder has an unlimited active-strategy entitlement', () => {
  assert.equal(planFor('FOUNDER').maximumActiveStrategies, null);
});

test('strategy save bypasses the count only for canonical unlimited entitlements', () => {
  assert.match(route, /if \(maximumActiveStrategies !== null\)/);
  assert.match(route, /STRATEGY_LIMIT_REACHED/);
  assert.doesNotMatch(route, /maximumActiveStrategies === null\)[\s\S]{0,300}The active strategy limit is unavailable/);
});
