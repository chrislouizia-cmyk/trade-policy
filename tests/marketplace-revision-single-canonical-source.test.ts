import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canonical, canonicalStrategyRevisionPayload } from '../lib/historical-decisions/fingerprint.ts';
import { strategyRevisionId } from '../lib/historical-decisions/strategy-revision.ts';

const migrationSql = readFileSync(new URL('../supabase/migrations/065_marketplace_revision_single_canonical_source.sql', import.meta.url), 'utf8');
const routeSource = readFileSync(new URL('../app/api/hq/marketplace/route.ts', import.meta.url), 'utf8');

const baseStrategy = {
  id: '4527ae05-eb1c-497d-9bfd-822f9ab6e6a6',
  engineVersion: 2,
  name: 'Gamma Core',
  description: '',
  isDefault: true,
  isArchived: false,
  marketTypes: ['FOREX'],
  instruments: ['XAUUSD', 'GBPUSD'],
  macroTimeframe: 'D1',
  trendTimeframe: 'H4',
  confirmationTimeframe: 'H1',
  entryTimeframe: 'M30',
  triggerTimeframe: 'M5',
  minimumRR: 3,
  preferredRR: 3,
  maximumRiskPercent: 0.5,
  maximumDailyRiskPercent: 1.5,
  maximumWeeklyRiskPercent: 4,
  maximumDailyLossPercent: 2,
  maximumTotalExposurePercent: 2,
  maximumCurrencyExposurePercent: 1,
  maximumTradesPerDay: 2,
  instrumentTradeLimits: { XAUUSD: 2, GBPUSD: 2 },
  greenDayProtectionEnabled: true,
  greenDayProtectedFloorMode: 'ZERO',
  greenDayProtectedFloorValue: 0,
  greenDayMaxExtraTrades: 1,
  greenDayExtraRiskMultiplier: 0.5,
  greenDayRequireAuthorized: true,
  maximumConsecutiveLosses: 5,
  allowedSessions: ['LONDON', 'NEW_YORK'],
  sessions: [
    { id: 's1', sessionCode: 'LONDON', name: 'London', timezone: 'Europe/London', startTime: '08:00', endTime: '16:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: false, isCustom: false },
    { id: 's2', sessionCode: 'NEW_YORK', name: 'New York', timezone: 'America/New_York', startTime: '13:00', endTime: '21:00', days: [1,2,3,4,5], allowOpenOutside: false, allowHoldOutside: false, isCustom: false },
  ],
  avoidHighImpactNews: true,
  newsMode: 'RELEVANT_CURRENCIES',
  newsBlockMinutesBefore: 30,
  newsBlockMinutesAfter: 15,
  newsCurrencies: ['USD','GBP','JPY'],
  requireTrendAlignment: true,
  requiredEvidence: ['h4TrendAligned', 'h1TrendAligned'],
  evidenceWeights: { h4TrendAligned: 10, h1TrendAligned: 10 },
  rules: [
    { ruleKey: 'trend-following', label: 'Trend following', enabled: true, mandatory: true, weight: 10, minimumConfidence: 60, timeframeRole: 'PRIMARY', evaluationMode: 'AUTOMATIC' },
    { ruleKey: 'risk-limit', label: 'Risk limit', enabled: true, mandatory: true, weight: 5, minimumConfidence: 50, timeframeRole: 'SUPPORT', evaluationMode: 'AUTOMATIC' },
  ],
  stopLimits: { XAUUSD: 2, GBPUSD: 0.003 },
  stopLimitSettings: [
    { instrument: 'XAUUSD', method: 'POINTS', minimumValue: 100, preferredValue: 150, maximumValue: 250 },
    { instrument: 'GBPUSD', method: 'PIPS', minimumValue: 12, preferredValue: 18, maximumValue: 30 },
  ],
  authorizationScore: 80,
  waitScore: 70,
  lossStreakLimit: 5,
  preferredSetups: ['Trend Continuation'],
  rejectUnlistedSetups: false,
  trailingConfig: {},
  exitConfig: {},
  monitorConfig: {},
  tradingStyle: 'day-trading',
  minimumHoldingMinutes: 15,
  strategyMethodologies: [],
  personalRules: [],
  aiBehavior: undefined,
} as any;

test('A. exact canonical app payload + matching DB normalized strategy passes', () => {
  const payloadText = canonicalStrategyRevisionPayload(baseStrategy);
  const payload = JSON.parse(payloadText);
  const expectedRevision = strategyRevisionId(baseStrategy);

  assert.equal(payload.strategy.id, baseStrategy.id);
  assert.equal(payloadText, canonical({ strategy: baseStrategy }));
  assert.equal(expectedRevision.startsWith(`${baseStrategy.engineVersion}:`), true);
  assert.match(migrationSql, /v_current_strategy\s*:=\s*public\.marketplace_normalize_strategy_profile_for_revision\(v_source_profile\.id\)/);
  assert.match(migrationSql, /v_normalized_strategy\s*:=\s*v_canonical_payload\s*->\s*'strategy'/);
});

test('B. same revision with one changed strategy field fails structural equality', () => {
  const mutated = { ...baseStrategy, description: 'mutated description' };
  const mutatedPayload = canonicalStrategyRevisionPayload(mutated);
  const parsed = JSON.parse(mutatedPayload);

  assert.notDeepEqual(parsed.strategy.description, baseStrategy.description);
  assert.notEqual(JSON.stringify(parsed.strategy), JSON.stringify(baseStrategy));
  assert.match(migrationSql, /if v_normalized_strategy <> v_current_strategy then/);
});

test('C. altered canonical text with old revision fails digest validation', () => {
  const payload = canonicalStrategyRevisionPayload(baseStrategy);
  const altered = payload.replace('Gamma Core', 'Gamma Core Mutated');
  assert.notEqual(payload, altered);
  assert.match(migrationSql, /extensions\.digest\(\s*convert_to\(p_canonical_strategy_text, 'UTF8'\),\s*'sha256'\s*\)/);
  assert.match(migrationSql, /v_expected_source_revision_id := v_engine_version \|\| ':' \|\| v_expected_hash/);
});

test('D. arbitrary revision cannot bypass the guard', () => {
  const arbitrary = '999:deadbeef';
  assert.match(migrationSql, /if v_expected_source_revision_id <> p_source_strategy_revision_id then/);
  assert.notEqual(arbitrary, strategyRevisionId(baseStrategy));
});

test('E. canonical strategy text never appears in the client response', () => {
  assert.match(routeSource, /p_canonical_strategy_text: canonicalStrategyText/);

  const responseBodyMatch = routeSource.match(/return\s+NextResponse\.json\(\s*\{([\s\S]*?)\}\s*\);?/);
  assert.ok(responseBodyMatch, 'expected a NextResponse.json return block');
  assert.doesNotMatch(responseBodyMatch[1], /canonicalStrategyText/i);
  assert.doesNotMatch(responseBodyMatch[1], /canonical strategy text/i);
  assert.doesNotMatch(responseBodyMatch[1], /JSON\.stringify\(\{\s*strategy\s*:/i);
});

test('F. the route passes exactly three RPC parameters', () => {
  assert.match(routeSource, /p_strategy_profile_id: sourceProfile\.id,\s*\n\s*p_source_strategy_revision_id: sourceStrategyRevisionId,\s*\n\s*p_canonical_strategy_text: canonicalStrategyText/);
});

test('G. DB no longer hashes marketplace_canonicalize_jsonb(... )::text for the app revision comparison', () => {
  assert.doesNotMatch(migrationSql, /marketplace_canonicalize_jsonb\(v_canonical_strategy\)::text/i);
  assert.doesNotMatch(migrationSql, /marketplace_canonicalize_jsonb\(.*\)::text/i);
  assert.match(migrationSql, /convert_to\(p_canonical_strategy_text, 'UTF8'\)/);
});
