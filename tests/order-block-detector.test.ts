import assert from 'node:assert/strict';
import test from 'node:test';
import type { NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { ORDER_BLOCK_SOURCE_MAX_LOOKBACK, createOrderBlockDetector, evaluateOrderBlocks, findOrderBlockSource } from '../lib/market-intelligence/detectors/order-block-detector.ts';
import { LifecycleReplayError } from '../lib/market-intelligence/detectors/lifecycle-replay.ts';

const base = Date.parse('2026-01-01T00:00:00.000Z');
const candle = (index: number, open: number, high: number, low: number, close: number): NormalizedCandle => ({ openedAt: new Date(base + index * 60_000).toISOString(), closedAt: new Date(base + (index + 1) * 60_000).toISOString(), open, high, low, close, volume: 1, complete: true });
const config = { instrument: 'XAUUSD', timeframe: 'M5' };
const bullish = () => [candle(0, 10, 11, 8, 9), candle(1, 9, 12, 9, 12)];

test('detects bullish and bearish order blocks from a displacement close', () => {
  const up = evaluateOrderBlocks(bullish(), config).orderBlocks[0];
  const down = evaluateOrderBlocks([candle(0, 9, 11, 8, 10), candle(1, 10, 10, 7, 7)], config).orderBlocks[0];
  assert.equal(up.direction, 'BULLISH'); assert.equal(down.direction, 'BEARISH');
  assert.equal(up.status, 'ACTIVE'); assert.equal(up.eligible, true);
});

test('does not invent a block without a displacement and ignores incomplete candles', () => {
  assert.equal(evaluateOrderBlocks([candle(0, 10, 11, 8, 9), candle(1, 9, 10, 8, 10)], config).orderBlocks.length, 0);
  const values = bullish(); values[1] = { ...values[1], complete: false };
  assert.equal(evaluateOrderBlocks(values, config).orderBlocks.length, 0);
});

test('source search uses nearest valid opposite source within exactly 20 candles', () => {
  const values = [candle(0, 10, 11, 8, 9), candle(1, 9, 10, 8, 10), candle(2, 10, 11, 9, 10.5), candle(3, 10.5, 12, 10, 12)];
  assert.equal(findOrderBlockSource(values, 3, 'BULLISH')?.openedAt, values[0].openedAt);
  const atTwenty = [candle(0, 10, 11, 8, 9), ...Array.from({ length: 19 }, (_, i) => candle(i + 1, 10, 11, 9, 10.5)), candle(20, 10, 12, 10, 12)];
  assert.ok(findOrderBlockSource(atTwenty, 20, 'BULLISH'));
  const atTwentyOne = [candle(0, 10, 11, 8, 9), ...Array.from({ length: 20 }, (_, i) => candle(i + 1, 10, 11, 9, 10.5)), candle(21, 10, 12, 10, 12)];
  assert.equal(findOrderBlockSource(atTwentyOne, 21, 'BULLISH'), null); assert.equal(ORDER_BLOCK_SOURCE_MAX_LOOKBACK, 20);
});

test('lifecycle uses close-only invalidation and retains partial eligibility', () => {
  const partial = evaluateOrderBlocks([...bullish(), candle(2, 12, 12, 9.5, 11)], config).orderBlocks.find(block => block.sourceCandleTime === bullish()[0].openedAt)!;
  const full = evaluateOrderBlocks([...bullish(), candle(2, 12, 12, 8, 10)], config).orderBlocks.find(block => block.sourceCandleTime === bullish()[0].openedAt)!;
  const invalid = evaluateOrderBlocks([...bullish(), candle(2, 12, 12, 7, 7.5)], config).orderBlocks.find(block => block.sourceCandleTime === bullish()[0].openedAt)!;
  assert.deepEqual([partial.status, partial.eligible], ['PARTIALLY_MITIGATED', true]);
  assert.deepEqual([full.status, full.eligible], ['MITIGATED', false]); assert.deepEqual([invalid.status, invalid.eligible], ['INVALIDATED', false]);
});

test('incremental replay is historical, deterministic, and emits each transition once', () => {
  const detector = createOrderBlockDetector(config); for (const value of bullish()) detector.pushCandle(value);
  const created = detector.getNewOrderBlocks(); assert.ok(created.created.length); assert.deepEqual(detector.getNewOrderBlocks(), { created: [], transitioned: [] });
  const before = detector.query(bullish()[1].closedAt); detector.pushCandle(candle(2, 12, 12, 8, 10));
  assert.equal(before.orderBlocks[0].status, 'ACTIVE'); assert.equal(detector.getResult().orderBlocks.find(block => block.sourceCandleTime === bullish()[0].openedAt)?.status, 'MITIGATED');
  assert.ok(detector.getNewOrderBlocks().transitioned.length); assert.deepEqual(detector.query(bullish()[1].closedAt), before);
});

test('incremental replay rejects duplicate and time-travel inputs and reset clears state', () => {
  const detector = createOrderBlockDetector(config); detector.pushCandle(bullish()[0]);
  assert.throws(() => detector.pushCandle(bullish()[0]), (error: unknown) => error instanceof LifecycleReplayError && error.code === 'DUPLICATE_CANDLE');
  assert.throws(() => detector.pushCandle(candle(-1, 10, 11, 9, 10)), (error: unknown) => error instanceof LifecycleReplayError && error.code === 'OUT_OF_ORDER_INCREMENTAL_INPUT');
  detector.reset(); assert.equal(detector.getResult().orderBlocks.length, 0);
});
