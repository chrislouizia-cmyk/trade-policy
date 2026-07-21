import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisContextBuilder } from '../lib/market-intelligence/analysis/analysis-context-builder.ts';
import type { MarketDataSnapshot, SessionObservation } from '../lib/market-intelligence/contracts.ts';
import { SessionDetector } from '../lib/market-intelligence/detectors/session/session-detector.ts';
import type { TradingSessionConfig } from '../lib/market-intelligence/detectors/session/session-types.ts';
import { compareManualSession } from '../lib/market-intelligence/detectors/session/session-utils.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';
import { DetectorRunner } from '../lib/market-intelligence/runner/detector-runner.ts';

function snapshot(dataAsOf: string): MarketDataSnapshot {
  return { id: `snapshot-${dataAsOf}`, snapshotVersion: '1.0.0', provider: 'fixture', providerVersion: '1.0.0', providerSymbol: 'XAU/USD', instrument: 'XAUUSD', timeframe: 'H1', requestedAt: dataAsOf, receivedAt: dataAsOf, dataAsOf, freshness: { state: 'FRESH', dataAsOf, ageMs: 0, maximumAgeMs: 60_000 }, candles: [], validationWarnings: [] };
}

const only = (id: string, name: string, timezone: string, startTime: string, endTime: string): TradingSessionConfig => ({ id, name, market: 'FOREX', timezone, startTime, endTime, weekdays: [1, 2, 3, 4, 5] });

async function detect(at: string, session?: TradingSessionConfig): Promise<SessionObservation> {
  const result = await new SessionDetector(session ? { sessions: [session] } : {}).execute(snapshot(at));
  assert.equal(result.status, 'DETECTED', result.warnings.join(', '));
  assert.ok(result.payload);
  return result.payload;
}

test('detects London, New York, Tokyo, and Sydney using their configured timezones', async () => {
  const cases = [
    ['london', 'London', 'Europe/London', '2026-01-15T10:00:00.000Z'],
    ['new-york', 'New York', 'America/New_York', '2026-01-15T15:00:00.000Z'],
    ['tokyo', 'Tokyo', 'Asia/Tokyo', '2026-01-15T02:00:00.000Z'],
    ['sydney', 'Sydney', 'Australia/Sydney', '2026-01-15T00:00:00.000Z'],
  ] as const;
  for (const [id, name, timezone, at] of cases) {
    const observation = await detect(at, only(id, name, timezone, '08:00', '17:00'));
    assert.equal(observation.sessionId, id);
    assert.equal(observation.status, 'OPEN');
  }
});

test('weekends are closed and holidays remain explicitly unknown', async () => {
  const observation = await detect('2026-01-17T12:00:00.000Z', only('london', 'London', 'Europe/London', '08:00', '17:00'));
  assert.equal(observation.status, 'CLOSED');
  assert.equal(observation.isWeekend, true);
  assert.equal(observation.isHoliday, null);
});

test('London UTC conversion follows both DST start and DST end', async () => {
  const london = only('london', 'London', 'Europe/London', '08:00', '17:00');
  const summer = await detect('2026-03-30T07:30:00.000Z', london);
  const winter = await detect('2026-10-26T08:30:00.000Z', london);
  assert.equal(summer.startTime, '2026-03-30T07:00:00.000Z');
  assert.equal(winter.startTime, '2026-10-26T08:00:00.000Z');
});

test('sessions crossing midnight remain open on the following local day', async () => {
  const observation = await detect('2026-01-13T02:00:00.000Z', only('overnight', 'Overnight', 'UTC', '22:00', '06:00'));
  assert.equal(observation.status, 'OPEN');
  assert.equal(observation.startTime, '2026-01-12T22:00:00.000Z');
  assert.equal(observation.endTime, '2026-01-13T06:00:00.000Z');
});

test('reports opening-soon and closing-soon boundaries in whole minutes', async () => {
  const london = only('london', 'London', 'Europe/London', '08:00', '17:00');
  const opening = await detect('2026-01-15T07:30:00.000Z', london);
  const closing = await detect('2026-01-15T16:30:00.000Z', london);
  assert.equal(opening.status, 'OPENING_SOON');
  assert.equal(opening.minutesUntilOpen, 30);
  assert.equal(closing.status, 'CLOSING_SOON');
  assert.equal(closing.minutesUntilClose, 30);
});

test('preserves overlapping sessions instead of resolving the overlap', async () => {
  const observation = await detect('2026-01-15T14:00:00.000Z');
  assert.equal(observation.sessionId, 'london');
  assert.deepEqual(observation.overlappingSessions.map((session) => session.sessionId), ['new-york']);
});

test('unknown timezones return a deterministic configuration error', async () => {
  const result = await new SessionDetector({ sessions: [only('bad', 'Bad', 'Mars/Olympus', '08:00', '17:00')] }).execute(snapshot('2026-01-15T12:00:00.000Z'));
  assert.equal(result.status, 'ERROR');
  assert.equal(result.errorCode, 'SESSION_CONFIGURATION_ERROR');
  assert.match(result.warnings[0], /time zone/i);
});

test('manual comparison returns MATCH, MISMATCH, and UNKNOWN including overlaps', async () => {
  const observation = await detect('2026-01-15T14:00:00.000Z');
  assert.equal(compareManualSession(observation, 'London'), 'MATCH');
  assert.equal(compareManualSession(observation, 'new-york'), 'MATCH');
  assert.equal(compareManualSession(observation, 'Tokyo'), 'MISMATCH');
  assert.equal(compareManualSession(null, 'London'), 'UNKNOWN');
  assert.equal(compareManualSession({ ...observation, status: 'CLOSED' }, 'London'), 'UNKNOWN');
});

test('session detector metadata and bootstrap registration define the reference implementation', () => {
  const detector = createDetectorRegistry().get('session');
  assert.ok(detector);
  assert.deepEqual(detector.metadata, { id: 'session', version: '1.0.0', displayName: 'Session Detector', deterministic: true, supportedTimeframes: ['GLOBAL'], supportsReplay: true, experimental: true, enabledByDefault: true, description: 'Determines configured market-session state from an immutable market-data timestamp.' });
});

test('runner and context builder preserve the session observation and JSON serialization', async () => {
  const registry = new DetectorRegistry().register(new SessionDetector()).freeze();
  const run = await new DetectorRunner(registry, { now: () => Date.parse('2026-01-15T14:00:00.000Z'), createRunId: () => 'session-run' }).execute(snapshot('2026-01-15T14:00:00.000Z'), ['session']);
  const context = new AnalysisContextBuilder({ now: () => '2026-01-15T14:00:00.000Z' }).build(snapshot('2026-01-15T14:00:00.000Z'), run);
  assert.equal(run.detectorResults[0].runId, 'session-run');
  assert.equal((context.detectorResultsByTimeframe.GLOBAL[0].payload as SessionObservation).sessionId, 'london');
  assert.deepEqual(JSON.parse(JSON.stringify(context)), context);
});
