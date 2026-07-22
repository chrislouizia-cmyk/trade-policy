import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLocalMarketRegime, LOCAL_REGIME_METHOD_VERSION } from '../lib/market-intelligence/engine-validation/index.ts';

const candles = (closes: readonly number[]) => closes.map((close, index) => Object.freeze({ openedAt: new Date(Date.UTC(2024, 0, 1, 0, index * 15)).toISOString(), closedAt: new Date(Date.UTC(2024, 0, 1, 0, (index + 1) * 15)).toISOString(), open: close, high: close + 1, low: close - 1, close, volume: 1, complete: true }));

test('local regime uses preregistered SMA20 slope and price-location rules', () => {
  const bullish = classifyLocalMarketRegime(candles(Array.from({ length: 30 }, (_, index) => 100 + index)));
  const bearish = classifyLocalMarketRegime(candles(Array.from({ length: 30 }, (_, index) => 130 - index)));
  const range = classifyLocalMarketRegime(candles(Array.from({ length: 30 }, (_, index) => index % 2 ? 101 : 99)));
  assert.equal(bullish.regime, 'BULLISH');
  assert.equal(bearish.regime, 'BEARISH');
  assert.equal(range.regime, 'RANGE');
  assert.equal(bullish.methodVersion, LOCAL_REGIME_METHOD_VERSION);
  assert.equal(bullish.candleCount, 30);
  assert.ok(Object.isFrozen(bullish));
});

test('local regime is deterministic and rejects insufficient or incomplete input', () => {
  const input = candles(Array.from({ length: 30 }, (_, index) => 100 + index));
  assert.deepEqual(classifyLocalMarketRegime(input), classifyLocalMarketRegime(input));
  assert.throws(() => classifyLocalMarketRegime(input.slice(0, 20)), /at least 21/);
  assert.throws(() => classifyLocalMarketRegime([...input.slice(0, -1), { ...input.at(-1)!, complete: false }]), /completed candles/);
});
