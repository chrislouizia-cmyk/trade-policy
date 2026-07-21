import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DetectorResult,
  MarketContext,
  NewsObservation,
  OrderBlockObservation,
  SessionObservation,
  StrategyEvaluation,
  StructureObservation,
  TradeDecision,
  TrendObservation,
} from '../lib/market-intelligence/contracts.ts';

const timestamp = '2026-07-21T12:00:00.000Z';
const freshness = { state: 'FRESH' as const, dataAsOf: timestamp, ageMs: 1_000, maximumAgeMs: 60_000 };

function detector<T extends import('../lib/market-intelligence/contracts.ts').JsonValue>(
  detectorId: string,
  timeframe: string,
  status: DetectorResult<T>['status'],
  payload: T | null,
): DetectorResult<T> {
  return {
    detectorId,
    detectorVersion: '1.0.0',
    runId: `run-${detectorId}-${timeframe}`,
    instrument: 'XAUUSD',
    timeframe,
    observedAt: timestamp,
    dataAsOf: timestamp,
    status,
    confidence: payload === null ? null : 90,
    payload,
    evidence: [{ id: `evidence-${detectorId}-${timeframe}`, type: 'CANDLE', description: 'Fixed test evidence.', candleTimes: [timestamp], priceLevels: [2_400] }],
    freshness,
    warnings: [],
  };
}

const session = detector<SessionObservation>('session', 'GLOBAL', 'DETECTED', {
  sessionId: 'london', sessionName: 'London', market: 'FOREX', timezone: 'Europe/London', status: 'OPEN',
  startTime: timestamp, endTime: timestamp, minutesUntilOpen: null, minutesUntilClose: 60, isWeekend: false, isHoliday: null, overlappingSessions: [],
});
const news = detector<NewsObservation[]>('news', 'GLOBAL', 'NOT_DETECTED', []);
const bullish = detector<TrendObservation>('trend', 'H4', 'DETECTED', { direction: 'BULLISH', timeframe: 'H4', fastAverage: { type: 'SMA', period: 10, value: 2_402 }, slowAverage: { type: 'SMA', period: 24, value: 2_400 }, latestClose: 2_403, fastSlowDifference: 2, fastSlowDifferencePercent: 0.08333333333333334, closeToSlowDifference: 3, closeToSlowDifferencePercent: 0.125, sourceStartTime: timestamp, sourceEndTime: timestamp, lastCandleTime: timestamp, candleCount: 24 });
const bearish = detector<TrendObservation>('trend', 'M15', 'DETECTED', { direction: 'BEARISH', timeframe: 'M15', fastAverage: { type: 'SMA', period: 10, value: 2_398 }, slowAverage: { type: 'SMA', period: 24, value: 2_400 }, latestClose: 2_397, fastSlowDifference: -2, fastSlowDifferencePercent: -0.08333333333333334, closeToSlowDifference: -3, closeToSlowDifferencePercent: -0.125, sourceStartTime: timestamp, sourceEndTime: timestamp, lastCandleTime: timestamp, candleCount: 24 });
const unavailable = detector<StructureObservation>('structure', 'M15', 'INSUFFICIENT_DATA', null);

const context: MarketContext = {
  contextId: 'context-1',
  contextVersion: '1.0.0',
  instrument: 'XAUUSD',
  provider: 'fixture', providerVersion: '1.0.0', timeframes: ['H4', 'M15'],
  snapshotId: 'snapshot-1', snapshotVersion: '1.0.0', snapshotFreshness: freshness,
  detectorRunId: 'run-1', detectorResults: [session, news, bullish, bearish, unavailable],
  detectorResultsByTimeframe: { GLOBAL: [session, news], H4: [bullish], M15: [bearish, unavailable] }, warnings: [],
  conflicts: [{ id: 'conflict-1', type: 'TIMEFRAME_DISAGREEMENT', description: 'H4 bullish while M15 bearish.', detectorIds: ['trend'], timeframes: ['H4', 'M15'], evidenceIds: ['evidence-trend-H4', 'evidence-trend-M15'], severity: 'WARNING' }],
  overallFreshness: 'FRESH',
  overallConfidence: 82,
  dataAsOf: timestamp,
  generatedAt: timestamp,
};

test('contract fixtures round-trip through JSON without data loss', () => {
  const serialized = JSON.stringify(context);
  assert.deepEqual(JSON.parse(serialized), context);
  assert.doesNotMatch(serialized, /undefined/);
});

test('detector statuses preserve NOT_DETECTED separately from INSUFFICIENT_DATA', () => {
  assert.equal(news.status, 'NOT_DETECTED');
  assert.deepEqual(news.payload, []);
  assert.equal(unavailable.status, 'INSUFFICIENT_DATA');
  assert.equal(unavailable.payload, null);
});

test('detector results have no final trade-decision field', () => {
  assert.equal('decision' in bullish, false);
  assert.equal('direction' in bullish, false);
  assert.equal('recommendation' in bullish, false);
});

test('MarketContext preserves conflicting timeframe detector results', () => {
  assert.equal(context.detectorResults.find((result) => result.timeframe === 'H4')?.payload, bullish.payload);
  assert.equal(context.detectorResults.find((result) => result.timeframe === 'M15' && result.detectorId === 'trend')?.payload, bearish.payload);
  assert.equal(context.conflicts.length, 1);
});

test('BLOCKED strategy evaluation remains blocked with a high compatibility score', () => {
  const evaluation: StrategyEvaluation = {
    id: 'strategy-evaluation-1', strategyId: 'strategy-1', strategyVersion: 3, engineVersion: '1.0.0', status: 'BLOCKED', compatibilityScore: 99,
    ruleResults: [{ ruleId: 'news-rule', mode: 'BLOCKING', status: 'BLOCKED', confidence: 100, evidenceIds: ['news-1'], explanation: 'Restricted news window matched.', blockingReason: 'High-impact news.' }],
    requiredRulesPassed: 8, requiredRulesFailed: 0, blockingRulesTriggered: 1, evaluatedAt: timestamp,
  };
  assert.equal(evaluation.status, 'BLOCKED');
  assert.equal(evaluation.compatibilityScore, 99);
  assert.equal(evaluation.blockingRulesTriggered, 1);
});

test('TradeDecision confidence is evidence completeness, not profit probability', () => {
  const decision: TradeDecision = {
    id: 'decision-1', decisionEngineVersion: '1.0.0', decision: 'WAIT', confidence: 75, confidenceMeaning: 'EVIDENCE_COMPLETENESS',
    primaryReason: 'Required evidence is incomplete.', supportingReasons: [], blockingReasons: [], warnings: [], strategyCompatibility: 75, riskAllowed: true,
    contextId: context.contextId, strategyEvaluationId: 'strategy-evaluation-1', riskEvaluationId: 'risk-evaluation-1', generatedAt: timestamp,
  };
  assert.equal(decision.confidenceMeaning, 'EVIDENCE_COMPLETENESS');
  assert.doesNotMatch(JSON.stringify(decision), /WIN_PROBABILITY|PROFIT_PROBABILITY|SUCCESS_RATE/);
});

test('version, freshness, evidence, warning, and timestamp fields are represented', () => {
  assert.equal(bullish.detectorVersion, '1.0.0');
  assert.equal(bullish.freshness.state, 'FRESH');
  assert.equal(bullish.observedAt, timestamp);
  assert.equal(bullish.dataAsOf, timestamp);
  assert.ok(bullish.evidence.length > 0);
  assert.deepEqual(bullish.warnings, []);
  assert.equal(context.contextVersion, '1.0.0');
  assert.equal(context.generatedAt, timestamp);
});
