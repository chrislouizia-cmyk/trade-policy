import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY,
  isAutomaticMarketIntelligenceV1Enabled,
  resolveAutomaticMarketIntelligenceV1,
} from '../lib/market-intelligence/feature-flags.ts';

test('automatic market intelligence flag is false when missing', () => {
  const previous = process.env[AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY];
  delete process.env[AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY];
  try {
    assert.equal(isAutomaticMarketIntelligenceV1Enabled(), false);
  } finally {
    if (previous === undefined) delete process.env[AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY];
    else process.env[AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY] = previous;
  }
});

test('automatic market intelligence flag rejects empty and unsupported values', () => {
  for (const value of ['', 'false', '1', 'yes', 'enabled', 'arbitrary text']) {
    assert.equal(resolveAutomaticMarketIntelligenceV1(value), false, value);
  }
});

test('automatic market intelligence flag accepts only explicit true case-insensitively', () => {
  for (const value of ['true', 'TRUE', ' True ', '\tTrUe\n']) {
    assert.equal(resolveAutomaticMarketIntelligenceV1(value), true, value);
  }
});
