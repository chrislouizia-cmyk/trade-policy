import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { strategyTimeframeContext, strategyTimeframes } from '../lib/strategy-timeframes.ts';

const requiredStrategyFields = {
  instruments: ['XAUUSD'],
  maximumRiskPercent: 0.5,
  minimumRR: 2,
  maximumTradesPerDay: 2,
  allowedSessions: ['LONDON'],
  avoidHighImpactNews: false,
  requireTrendAlignment: true,
  requiredEvidence: [],
  evidenceWeights: {} as Record<string, number>,
  stopLimits: { XAUUSD: 2 },
  authorizationScore: 80,
  waitScore: 70,
  lossStreakLimit: 3,
};

const strategyA = {
  id: 'strategy-a',
  name: 'Strategy A',
  trendTimeframe: 'H4',
  confirmationTimeframe: 'H1',
  entryTimeframe: 'M20',
  triggerTimeframe: 'M5',
  macroTimeframe: 'D1',
  ...requiredStrategyFields,
};

const strategyB = {
  id: 'strategy-b',
  name: 'Strategy B',
  trendTimeframe: 'H4',
  confirmationTimeframe: 'H1',
  entryTimeframe: 'M15',
  ...requiredStrategyFields,
};

const minimalStrategy = {
  id: 'minimal-strategy',
  name: 'Minimal Strategy',
  trendTimeframe: 'H4',
  entryTimeframe: 'M15',
  ...requiredStrategyFields,
};

const marketAnalyzeRoute = readFileSync(new URL('../app/api/market/analyze/route.ts', import.meta.url), 'utf8');
const tradeValidator = readFileSync(new URL('../components/TradeValidator.tsx', import.meta.url), 'utf8');
const liveMarketPanel = readFileSync(new URL('../components/LiveMarketPanel.tsx', import.meta.url), 'utf8');

test('strategy-specific timeframe context and analysis input differ between A and B without hardcoded fallback timeframes', () => {
  const contextA = strategyTimeframeContext(strategyA as any);
  const contextB = strategyTimeframeContext(strategyB as any);

  assert.equal(
    contextA,
    'Trade Police checks macro D1 · trend H4 · confirmation H1 · entry M20 · trigger M5 against your saved rules.',
  );
  assert.equal(
    contextB,
    'Trade Police checks trend H4 · confirmation H1 · entry M15 against your saved rules.',
  );
  assert.notEqual(contextA, contextB);
  assert.deepEqual(strategyTimeframes(strategyA as any), ['D1', 'H4', 'H1', 'M20', 'M5']);
  assert.deepEqual(strategyTimeframes(strategyB as any), ['H4', 'H1', 'M15']);
  assert.notDeepEqual(strategyTimeframes(strategyA as any), strategyTimeframes(strategyB as any));
  assert.doesNotMatch(contextA, /macro.*D1.*H4.*H1.*M20.*M5.*macro/);
  assert.doesNotMatch(contextB, /macro|trigger/);

  assert.match(marketAnalyzeRoute, /strategy\s*=\s*await\s*loadActiveStrategy\(supabase,user\.id\);/);
  assert.doesNotMatch(marketAnalyzeRoute, /loadStrategyById\s*\(/);
  assert.match(marketAnalyzeRoute, /const timeframes = strategyTimeframes\(strategy\);/);
  assert.match(marketAnalyzeRoute, /strategy_revision_id:strategyRevisionId\(strategy\)/);
  assert.doesNotMatch(marketAnalyzeRoute, /body\.strategyRevisionId/);
  assert.doesNotMatch(marketAnalyzeRoute, /fixed.*timeframe|default.*timeframes|D1.*H4.*H1.*M20.*M5/);
  assert.match(tradeValidator, /<LiveMarketPanel strategy=\{strategy\} strategyRevisionId=\{activeStrategyRevisionId\}/);
  assert.match(tradeValidator, /const \[activeStrategyRevisionId,setActiveStrategyRevisionId\]=useState<string\|null>\(null\);/);
  assert.match(tradeValidator, /setActiveStrategyRevisionId\(null\);/);
  assert.match(tradeValidator, /setActiveStrategyRevisionId\(nextRevision\);/);
  assert.match(tradeValidator, /setLastAnalysisInput\(null\)/);
  assert.match(tradeValidator, /setSessionHistory\(\[\]\)/);
  assert.match(tradeValidator, /initialManualConfirmations\(nextStrategy\.rules\s*\?\?\s*\[\]\)/);
  assert.match(liveMarketPanel, /if \(!strategy\.id \|\| !strategyRevisionId\)/);
  assert.match(liveMarketPanel, /strategyRevisionId: strategyRevisionId,/);
  assert.doesNotMatch(tradeValidator, /historical-decisions\/strategy-revision/);
  assert.doesNotMatch(liveMarketPanel, /historical-decisions\/strategy-revision|strategyRevisionId\(strategy\)/);
  assert.doesNotMatch(tradeValidator, /node:crypto/);
});

test('minimal strategy omits undefined roles and never displays nonexistent roles', () => {
  const context = strategyTimeframeContext(minimalStrategy as any);

  assert.equal(context, 'Trade Police checks trend H4 · entry M15 against your saved rules.');
  assert.doesNotMatch(context, /macro|confirmation|trigger/);
  assert.deepEqual(strategyTimeframes(minimalStrategy as any), ['H4', 'M15']);
});
