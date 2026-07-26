import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptStrategyDna, buildResearchBundle, calculateMetrics, classifySampleSize, createBacktestDataset, createStrategyMappingSnapshot, evaluateSignal, importDatasetArtifact, metricsFromLedger, normalizeCandles,
  runBacktest, simulateTrade, type Candle, type CostScenario, type ExecutableStrategy, type Signal, type SimulatedTrade,
} from '../lib/backtesting/index.ts';

const candle = (index: number, values: Partial<Omit<Candle, 'timestamp'>> = {}): Candle => Object.freeze({
  timestamp: new Date(Date.UTC(2024, 0, 1, 0, index * 15)).toISOString(),
  open: 100 + index, high: 101 + index, low: 99 + index, close: 100.5 + index, volume: 100 + index, ...values,
});
const history = (count = 80): readonly Candle[] => Object.freeze(Array.from({ length: count }, (_, index) => candle(index)));
const dataset = (candles: readonly Candle[] = history()) => Object.freeze({ symbol: 'XAUUSD', timeframe: 'M15', timezone: 'UTC', source: 'fixture', startTime: candles[0]!.timestamp, endTime: candles.at(-1)!.timestamp, candles });
const defaultEntryRules: ExecutableStrategy['entryRules'] = Object.freeze([{ id: 'bull', type: 'CANDLE_DIRECTION', direction: 'BULLISH', required: true }]);
const baseStrategy: ExecutableStrategy = {
  id: 'sample', name: 'Sample', version: '1.0.0', direction: 'LONG',
  entryRules: defaultEntryRules,
  forbiddenRules: Object.freeze([]), stopLossRule: { type: 'FIXED_PRICE', distance: 1 }, takeProfitRule: { type: 'FIXED_PRICE', distance: 2 },
  minimumRequiredConfirmations: 1, maximumHoldingPeriod: 10,
};
const strategy = (patch: Partial<ExecutableStrategy> = {}): ExecutableStrategy => Object.freeze({ ...baseStrategy, ...patch });
const signal = (patch: Partial<Signal> = {}): Signal => Object.freeze({ timestamp: candle(0).timestamp, candleIndex: 0, direction: 'LONG', entryPrice: 100, stopPrice: 99, targetPrice: 102, matchedRules: [], missingRules: [], blockedRules: [], evaluations: [], ...patch });
const configuration = Object.freeze({ entryTiming: 'NEXT_OPEN' as const, intrabarConflictPolicy: 'STOP_FIRST' as const, allowOverlappingTrades: false, costs: Object.freeze({ commissionR: 0, spreadPrice: 0, slippagePrice: 0 }), maximumHoldingBars: 10 });
const trade = (pnlR: number, index: number): SimulatedTrade => Object.freeze({ signalTimestamp: candle(index).timestamp, entryTimestamp: candle(index).timestamp, exitTimestamp: candle(index + 1).timestamp, direction: index % 2 ? 'SHORT' : 'LONG', entryPrice: 100, stopPrice: 99, targetPrice: 102, exitPrice: 100 + pnlR, outcome: pnlR > 0 ? 'WIN' : pnlR < 0 ? 'LOSS' : 'BREAK_EVEN', pnlR, rawPnlR: pnlR, costsR: 0, maximumFavorableExcursionR: Math.max(0, pnlR), maximumAdverseExcursionR: Math.max(0, -pnlR), barsHeld: 1, exitReason: pnlR > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS' });

test('normalization sorts chronologically and converts numeric fields', () => {
  const normalized = normalizeCandles([{ datetime: '2024-01-01 00:15:00', open: '2', high: '3', low: '1', close: '2' }, { datetime: '2024-01-01 00:00:00', open: '1', high: '2', low: '0', close: '1' }]);
  assert.equal(normalized[0]!.timestamp, '2024-01-01T00:00:00.000Z');
  assert.equal(normalized[0]!.open, 1);
});

test('duplicate timestamps reject by default and KEEP_LAST is explicit', () => {
  const duplicate = [{ timestamp: '2024-01-01T00:00:00Z', open: 1, high: 2, low: 0, close: 1 }, { timestamp: '2024-01-01T00:00:00Z', open: 2, high: 3, low: 1, close: 2 }];
  assert.throws(() => normalizeCandles(duplicate), /Duplicate/);
  assert.equal(normalizeCandles(duplicate, 'KEEP_LAST')[0]!.close, 2);
});

test('signal evaluation cannot observe future candles', () => {
  const prefix = history(30), first = evaluateSignal(strategy(), prefix, 29);
  const changedFuture = [...prefix, candle(30, { close: -1, low: -2, high: 200 })];
  assert.deepEqual(evaluateSignal(strategy(), changedFuture.slice(0, 30), 29), first);
});

test('EMA relation and close-vs-EMA rules evaluate deterministically', () => {
  const configured = strategy({ entryRules: [{ id: 'ema', type: 'EMA_RELATION', fastPeriod: 3, slowPeriod: 10, relation: 'ABOVE' }, { id: 'close', type: 'CLOSE_VS_EMA', period: 10, relation: 'ABOVE' }], minimumRequiredConfirmations: 2 });
  const result = evaluateSignal(configured, history(30), 29);
  assert.deepEqual(result?.matchedRules, ['ema', 'close']);
});

test('breakout uses only the previous configured lookback', () => {
  const candles = [...history(10), candle(10, { open: 110, high: 120, low: 109, close: 119 })];
  const result = evaluateSignal(strategy({ entryRules: [{ id: 'break', type: 'BREAKOUT', lookback: 5, direction: 'ABOVE' }], minimumRequiredConfirmations: 1 }), candles, 10);
  assert.ok(result?.matchedRules.includes('break'));
});

test('session filtering supports normal and cross-midnight UTC windows', () => {
  const atMidnight = [candle(0)];
  assert.ok(evaluateSignal(strategy({ entryRules: [{ id: 'session', type: 'SESSION', startUtcMinute: 0, endUtcMinute: 60 }], minimumRequiredConfirmations: 1 }), atMidnight, 0));
  assert.ok(evaluateSignal(strategy({ entryRules: [{ id: 'session', type: 'SESSION', startUtcMinute: 1_380, endUtcMinute: 60 }], minimumRequiredConfirmations: 1 }), atMidnight, 0));
});

test('stop loss produces a deterministic loss', () => {
  const candles = [candle(0, { open: 100, high: 100.5, low: 99.5, close: 100 }), candle(1, { open: 100, high: 100.5, low: 98.5, close: 99 })];
  const result = simulateTrade(signal(), candles, configuration);
  assert.equal(result?.exitReason, 'STOP_LOSS'); assert.equal(result?.pnlR, -1);
});

test('take profit produces a deterministic win', () => {
  const candles = [candle(0, { open: 100, high: 100.5, low: 99.5, close: 100 }), candle(1, { open: 100, high: 102.5, low: 99.5, close: 102 })];
  const result = simulateTrade(signal(), candles, configuration);
  assert.equal(result?.exitReason, 'TAKE_PROFIT'); assert.equal(result?.pnlR, 2);
});

test('when stop and target are both touched the conservative stop-first assumption wins', () => {
  const candles = [candle(0, { open: 100, high: 101, low: 99, close: 100 }), candle(1, { open: 100, high: 103, low: 98, close: 101 })];
  assert.equal(simulateTrade(signal(), candles, configuration)?.exitReason, 'STOP_LOSS');
});

test('commission spread and slippage reduce simulated return', () => {
  const candles = [candle(0, { open: 100, high: 101, low: 99, close: 100 }), candle(1, { open: 100, high: 101, low: 99.5, close: 100.5 })];
  const free = simulateTrade(signal(), candles, { ...configuration, maximumHoldingBars: 1 })!;
  const costly = simulateTrade(signal(), candles, { ...configuration, maximumHoldingBars: 1, costs: { commissionR: .1, spreadPrice: .2, slippagePrice: .1 } })!;
  assert.ok(costly.pnlR < free.pnlR);
});

test('expectancy profit factor drawdown and streak metrics are exact', () => {
  const metrics = calculateMetrics([trade(2, 0), trade(1, 2), trade(-1, 4), trade(-1, 6), trade(0, 8)]);
  assert.equal(metrics.expectancyR, .2); assert.equal(metrics.profitFactor, 1.5);
  assert.equal(metrics.maximumDrawdownR, 2); assert.equal(metrics.longestWinningStreak, 2); assert.equal(metrics.longestLosingStreak, 2);
});

test('zero-trade metrics avoid division-by-zero and unsafe numbers', () => {
  const metrics = calculateMetrics([], 0);
  assert.equal(metrics.expectancyR, null); assert.equal(metrics.profitFactor, 0); assert.equal(metrics.winRate, 0);
  assert.doesNotMatch(JSON.stringify(metrics), /NaN|Infinity/);
});

test('unsupported Strategy DNA concepts invalidate adaptation rather than silently passing', () => {
  const result = adaptStrategyDna({ id: 'dna', name: 'DNA', version: '1', direction: 'long', rules: [{ id: 'ob', concept: 'order_block', required: true }], stopLoss: { type: 'FIXED_PRICE', distance: 1 }, takeProfit: { type: 'FIXED_PRICE', distance: 2 } });
  assert.equal(result.valid, false); assert.equal(result.strategy, null); assert.equal(result.issues[0]?.support, 'UNSUPPORTED');
});

test('chronological split is 70/30 and never shuffles time-series data', () => {
  const result = runBacktest(dataset(history(100)), strategy(), { runTimestamp: '2024-01-02T00:00:00.000Z' });
  assert.equal(result.inSample.candleCount, 70); assert.equal(result.outOfSample.candleCount, 30);
  assert.ok(Date.parse(result.inSample.endTime) < Date.parse(result.outOfSample.startTime));
});

test('same inputs and timestamp produce byte-identical deterministic outputs', () => {
  const options = { runTimestamp: '2024-01-02T00:00:00.000Z' };
  assert.equal(JSON.stringify(runBacktest(dataset(), strategy(), options)), JSON.stringify(runBacktest(dataset(), strategy(), options)));
});

test('engine reports genuine occurrences and never fabricates trades to reach 2,000', () => {
  const result = runBacktest(dataset(history(120)), strategy(), { runTimestamp: '2024-01-02T00:00:00.000Z' });
  assert.ok(result.trades.length < 2_000); assert.match(result.warnings.join(' '), /fewer than the 2,000/);
});

test('sample size quality boundaries are exact', () => {
  assert.equal(classifySampleSize(99), 'INSUFFICIENT'); assert.equal(classifySampleSize(100), 'LIMITED');
  assert.equal(classifySampleSize(500), 'MODERATE'); assert.equal(classifySampleSize(1_000), 'STRONG'); assert.equal(classifySampleSize(2_000), 'HIGH');
});

test('forbidden rules block otherwise qualifying signals', () => {
  const configured = strategy({ forbiddenRules: [{ id: 'blocked', type: 'CANDLE_DIRECTION', direction: 'BULLISH' }] });
  assert.equal(evaluateSignal(configured, history(5), 4), null);
});

test('dataset constructor derives immutable metadata boundaries', () => {
  const result = createBacktestDataset({ symbol: 'XAUUSD', timeframe: 'M15', timezone: 'UTC', source: 'fixture', candles: [{ timestamp: '2024-01-01T00:00:00Z', open: 1, high: 2, low: 0, close: 1 }] });
  assert.equal(result.startTime, result.endTime); assert.ok(Object.isFrozen(result.candles));
});

test('immutable dataset artifact records SHA-256 provenance and quality findings', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(history(30)));
  const artifact = importDatasetArtifact({ bytes, format: 'JSON', instrument: 'XAUUSD', provider: 'fixture', providerSymbol: 'XAU/USD', timeframe: 'M15', timezone: 'UTC', pricePrecision: 5, importTimestamp: '2024-02-01T00:00:00.000Z', sourceFilename: 'fixture.json', duplicateTimestampPolicy: 'REJECT', priceRepresentation: 'MIDPOINT', sourceVerificationReference: 'fixture-certification' });
  assert.equal(artifact.metadata.status, 'VERIFIED_SOURCE'); assert.equal(artifact.metadata.sha256FileHash.length, 64);
  assert.equal(artifact.validation.valid, true); assert.equal(artifact.metadata.candleCount, 30);
});

test('CSV artifact import is supported and material defects are never silently repaired', () => {
  const csv = 'timestamp,open,high,low,close,volume\n2024-01-01T00:00:00Z,1,2,0.5,1.5,10\n';
  assert.equal(importDatasetArtifact({ bytes: new TextEncoder().encode(csv), format: 'CSV', instrument: 'X', provider: 'user', providerSymbol: 'X', timeframe: 'M15', timezone: 'UTC', pricePrecision: 2, importTimestamp: '2024-01-01T01:00:00Z', sourceFilename: 'x.csv', duplicateTimestampPolicy: 'REJECT', priceRepresentation: 'UNKNOWN', userProvided: true }).metadata.status, 'USER_PROVIDED');
  const duplicate = `${csv}2024-01-01T00:00:00Z,1,2,0.5,1.5,10\n`;
  assert.throws(() => importDatasetArtifact({ bytes: new TextEncoder().encode(duplicate), format: 'CSV', instrument: 'X', provider: 'user', providerSymbol: 'X', timeframe: 'M15', timezone: 'UTC', pricePrecision: 2, importTimestamp: '2024-01-01T01:00:00Z', sourceFilename: 'x.csv', duplicateTimestampPolicy: 'REJECT', priceRepresentation: 'UNKNOWN' }), /failed without repair/);
});

test('required unsupported mapping stops with INVALID_STRATEGY_MAPPING', () => {
  assert.throws(() => createStrategyMappingSnapshot({ strategyId: 'x', strategyVersion: '1', strategyName: 'x', originalStoredStrategyDna: { requiredRuleIds: ['order-block'] }, mappedExecutableStrategy: strategy(), supportedRules: [], partiallySupportedRules: [], unsupportedRules: ['order-block'], omittedFields: [], interpretationDecisions: [], mappingWarnings: [] }), /INVALID_STRATEGY_MAPPING/);
});

test('ledger-derived metrics exactly match expected-cost engine metrics', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(history(140)));
  const artifact = importDatasetArtifact({ bytes, format: 'JSON', instrument: 'XAUUSD', provider: 'fixture', providerSymbol: 'XAU/USD', timeframe: 'M15', timezone: 'UTC', pricePrecision: 5, importTimestamp: '2024-02-01T00:00:00.000Z', sourceFilename: 'fixture.json', duplicateTimestampPolicy: 'REJECT', priceRepresentation: 'MIDPOINT', sourceVerificationReference: 'fixture-certification' });
  const mapping = createStrategyMappingSnapshot({ strategyId: 'sample', strategyVersion: '1.0.0', strategyName: 'Sample', originalStoredStrategyDna: { requiredRuleIds: ['bull'] }, mappedExecutableStrategy: strategy(), supportedRules: ['bull'], partiallySupportedRules: [], unsupportedRules: [], omittedFields: [], interpretationDecisions: [], mappingWarnings: [] });
  const config = Object.freeze({ entryTiming: 'NEXT_OPEN' as const, intrabarConflictPolicy: 'STOP_FIRST' as const, allowOverlappingTrades: false, costs: Object.freeze({ commissionR: 0, spreadPrice: 0, slippagePrice: 0 }), maximumHoldingBars: 10 });
  const scenarios: readonly CostScenario[] = [{ id: 'IDEALIZED', description: 'i', configuration: config }, { id: 'EXPECTED', description: 'e', configuration: config }, { id: 'CONSERVATIVE', description: 'c', configuration: config }];
  const bundle = buildResearchBundle(artifact, mapping, scenarios);
  assert.deepEqual(metricsFromLedger(bundle.ledger), bundle.baseline.metrics);
});
