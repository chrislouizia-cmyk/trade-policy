import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { DetectorResult, MarketDataSnapshot, NormalizedCandle } from '../lib/market-intelligence/contracts.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';
import { compareNumeric, createLegacyComparableObservations, ShadowValidator } from '../lib/market-intelligence/shadow-validation/index.ts';

const ids = ['atr', 'trend', 'range-levels', 'break-of-structure', 'liquidity-sweep', 'fair-value-gap', 'rejection-candle', 'volume-expansion', 'displacement', 'volatility-requirement', 'retest'];
const base = Date.parse('2026-02-02T00:00:00.000Z');
const candle = (index: number, close = 100, high = close + 5, low = close - 5): NormalizedCandle => ({ openedAt: new Date(base + index * 3_600_000).toISOString(), closedAt: new Date(base + (index + 1) * 3_600_000).toISOString(), open: close, high, low, close, volume: 100, complete: true });
function snapshot(candles = Array.from({ length: 30 }, (_, index) => candle(index, 80 + index)), timeframe = 'H1'): MarketDataSnapshot { const requestedAt = new Date(base + candles.length * 3_600_000).toISOString(); return { id: `shadow-${timeframe}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe, requestedAt, receivedAt: requestedAt, dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, freshness: { state: 'FRESH', dataAsOf: candles.at(-1)?.openedAt ?? requestedAt, ageMs: 0, maximumAgeMs: 60_000 }, candles, validationWarnings: [] }; }
async function contextFor(source: MarketDataSnapshot) { const summary = await new DetectorRunner(createDetectorRegistry(), { createRunId: () => 'shadow-run' }).execute(source, ids); return new AnalysisContextBuilder({ now: () => source.requestedAt }).build(source, summary); }

test('all five comparable detectors exactly match the traceable legacy adapter', async () => {
  const source = snapshot(), context = await contextFor(source), report = new ShadowValidator().validate(source, context);
  assert.deepEqual(report.comparisons.map((item) => item.detectorId), ids);
  assert.ok(report.comparisons.every((item) => item.status === 'MATCH' && item.exactMatch));
  assert.deepEqual(report.summary, { totalComparisons: 11, matches: 11, mismatches: 0, notComparable: 0, unavailable: 0, errors: 0, matchRate: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
});

test('trend fixtures preserve bullish, bearish, and range classifications', async (t) => {
  const fixtures = [
    ['BULLISH', Array.from({ length: 30 }, (_, index) => candle(index, 70 + index))],
    ['BEARISH', Array.from({ length: 30 }, (_, index) => candle(index, 130 - index))],
    ['RANGE', Array.from({ length: 30 }, (_, index) => candle(index, 100))],
  ] as const;
  for (const [expected, values] of fixtures) await t.test(expected, async () => { const source = snapshot([...values]); const report = new ShadowValidator().validate(source, await contextFor(source)); assert.equal((createLegacyComparableObservations(source).observations.find((item) => item.detectorId === 'trend')?.payload as { direction: string }).direction, expected); assert.equal(report.comparisons.find((item) => item.detectorId === 'trend')?.status, 'MATCH'); });
});

test('BOS and sweep classifications cover every legacy outcome', async (t) => {
  const events = [
    ['BULLISH', 'HIGH_SIDE', candle(29, 106, 111, 99)],
    ['BEARISH', 'LOW_SIDE', candle(29, 94, 101, 89)],
    ['NONE', 'BOTH', candle(29, 100, 111, 89)],
    ['NONE', 'NONE', candle(29, 100, 105, 95)],
  ] as const;
  for (const [bos, sweep, event] of events) await t.test(`${bos}/${sweep}`, async () => { const values = Array.from({ length: 29 }, (_, index) => bos === 'BULLISH' && index >= 10 && index <= 21 ? candle(index, 100, 110, 90) : bos === 'BEARISH' && index >= 10 && index <= 21 ? candle(index, 100, 110, 90) : candle(index)); values[29] = event; const source = snapshot(values); const legacy = createLegacyComparableObservations(source).observations; assert.equal((legacy.find((item) => item.detectorId === 'break-of-structure')?.payload as { direction: string }).direction, bos); assert.equal((legacy.find((item) => item.detectorId === 'liquidity-sweep')?.payload as { side: string }).side, sweep); const report = new ShadowValidator().validate(source, await contextFor(source)); assert.equal(report.comparisons.find((item) => item.detectorId === 'break-of-structure')?.status, 'MATCH'); assert.equal(report.comparisons.find((item) => item.detectorId === 'liquidity-sweep')?.status, 'MATCH'); });
});

test('numeric comparison exposes exact equality, delta, relative delta, and epsilon result', () => {
  assert.deepEqual(compareNumeric('atr', 100, 100 + 1e-11), { field: 'atr', legacyValue: 100, newValue: 100 + 1e-11, exactMatch: false, absoluteDelta: Math.abs(100 - (100 + 1e-11)), relativeDeltaPercent: Math.abs(100 - (100 + 1e-11)) / 100 * 100, withinTolerance: true });
  assert.equal(compareNumeric('atr', 100, 101).withinTolerance, false);
});

test('intentional detector mutations become field-level mismatches', async () => {
  const source = snapshot(), context = await contextFor(source);
  const mutated = context.detectorResults.map((result): DetectorResult => result.detectorId === 'atr' ? { ...result, payload: { ...(result.payload as object), atr: 999 } } : result.detectorId === 'trend' ? { ...result, payload: { ...(result.payload as object), direction: 'RANGE' } } : result.detectorId === 'range-levels' ? { ...result, payload: { ...(result.payload as object), previousHigh: 999 } } : result.detectorId === 'break-of-structure' ? { ...result, payload: { ...(result.payload as object), bullishBreak: true, direction: 'BULLISH' } } : result);
  const report = new ShadowValidator().validate(source, { ...context, detectorResults: mutated });
  assert.equal(report.comparisons.find((item) => item.detectorId === 'atr')?.status, 'MISMATCH');
  assert.equal(report.comparisons.find((item) => item.detectorId === 'trend')?.status, 'MISMATCH');
  assert.equal(report.comparisons.find((item) => item.detectorId === 'range-levels')?.status, 'MISMATCH');
  assert.equal(report.comparisons.find((item) => item.detectorId === 'break-of-structure')?.status, 'MISMATCH');
});

test('unavailable and malformed inputs map explicitly instead of becoming mathematical mismatches', async () => {
  const short = snapshot(Array.from({ length: 7 }, (_, index) => candle(index))); const unavailable = new ShadowValidator().validate(short, await contextFor(short));
  assert.ok(unavailable.comparisons.filter((item) => !['fair-value-gap', 'rejection-candle', 'volume-expansion'].includes(item.detectorId)).every((item) => item.status === 'BOTH_UNAVAILABLE')); assert.equal(unavailable.comparisons.find((item) => item.detectorId === 'fair-value-gap')?.status, 'MATCH'); assert.equal(unavailable.comparisons.find((item) => item.detectorId === 'rejection-candle')?.status, 'MATCH'); assert.equal(unavailable.comparisons.find((item) => item.detectorId === 'volume-expansion')?.status, 'MATCH');
  const malformed = snapshot(); malformed.candles[0] = { ...malformed.candles[0], high: Number.NaN }; const errored = new ShadowValidator().validate(malformed, await contextFor(malformed)); assert.ok(errored.comparisons.every((item) => item.status === 'ERROR'));
  const missing = snapshot(undefined, ''); const missingReport = new ShadowValidator().validate(missing, await contextFor(missing)); assert.ok(missingReport.comparisons.every((item) => item.status === 'ERROR'));
});

test('liquidity sweep regression uses prior slice(-20,-8), never recent slice(-8,-1)', async () => {
  const prior = Array.from({ length: 12 }, (_, index) => candle(index, 100, 110, 90)); const recent = Array.from({ length: 7 }, (_, index) => candle(index + 12, 100, 120, 80)); const source = snapshot([...prior, ...recent, candle(19, 100, 111, 89)]);
  const context = await contextFor(source); const exact = new ShadowValidator().validate(source, context); assert.equal(exact.comparisons.find((item) => item.detectorId === 'liquidity-sweep')?.status, 'MATCH');
  const wrong = context.detectorResults.map((result): DetectorResult => result.detectorId === 'liquidity-sweep' ? { ...result, payload: { ...(result.payload as object), side: 'NONE', highSideSweep: false, lowSideSweep: false, referenceHigh: 120, referenceLow: 80, highPenetration: null, lowPenetration: null } } : result);
  const mismatch = new ShadowValidator().validate(source, { ...context, detectorResults: wrong }).comparisons.find((item) => item.detectorId === 'liquidity-sweep'); assert.equal(mismatch?.status, 'MISMATCH'); assert.ok(mismatch?.mismatchReasons.some((reason) => reason.includes('referenceHigh')));
});

test('an incomplete final candle is excluded identically on both sides', async () => {
  const complete = Array.from({ length: 30 }, (_, index) => candle(index, 80 + index));
  const incomplete = { ...candle(30, 500), complete: false };
  const source = snapshot([...complete, incomplete]);
  source.requestedAt = complete.at(-1)!.closedAt;
  source.receivedAt = source.requestedAt;
  const report = new ShadowValidator().validate(source, await contextFor(source));
  assert.ok(report.comparisons.every((item) => item.status === 'MATCH'));
});

test('timeframes produce independent reports and comparisons', async () => {
  const h1 = snapshot(undefined, 'H1'), h4 = snapshot(undefined, 'H4');
  const h1Report = new ShadowValidator().validate(h1, await contextFor(h1));
  const h4Report = new ShadowValidator().validate(h4, await contextFor(h4));
  assert.ok(h1Report.comparisons.every((item) => item.timeframe === 'H1'));
  assert.ok(h4Report.comparisons.every((item) => item.timeframe === 'H4'));
  assert.equal(h1Report.summary.matches, 11); assert.equal(h4Report.summary.matches, 11);
});
