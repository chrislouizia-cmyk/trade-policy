import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { strategyTimeframeContext } from '../lib/strategy-timeframes.ts';
import {
  clearUserScopedSessionState,
  getUserScopedStorageKey,
  isStrategySelectionOwnedByUser,
} from '../lib/user-session-state.ts';

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

test('strategy timeframe sentence reflects the active strategy and shows Not configured for missing roles', () => {
  const strategyA = {
    id: 'strategy-a',
    name: 'Strategy A',
    macroTimeframe: 'D1',
    trendTimeframe: 'H4',
    confirmationTimeframe: 'H1',
    entryTimeframe: 'M30',
    triggerTimeframe: 'M5',
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

  const strategyC = {
    id: 'strategy-c',
    name: 'Strategy C',
    macroTimeframe: undefined,
    trendTimeframe: 'H4',
    confirmationTimeframe: undefined,
    entryTimeframe: 'M15',
    triggerTimeframe: undefined,
    ...requiredStrategyFields,
  };

  assert.equal(
    strategyTimeframeContext(strategyA as any),
    'Trade Police checks macro D1 · trend H4 · confirmation H1 · entry M30 · trigger M5 against your saved rules.',
  );

  assert.equal(
    strategyTimeframeContext(strategyB as any),
    'Trade Police checks macro Not configured · trend H4 · confirmation H1 · entry M15 · trigger Not configured against your saved rules.',
  );

  assert.equal(
    strategyTimeframeContext(strategyC as any),
    'Trade Police checks macro Not configured · trend H4 · confirmation Not configured · entry M15 · trigger Not configured against your saved rules.',
  );

  assert.doesNotMatch(strategyTimeframeContext(strategyB as any), /macro D1|trigger M5|macro H1|trigger M30/);
  assert.doesNotMatch(strategyTimeframeContext(strategyC as any), /macro D1|confirmation H1|trigger M5/);
});

test('header order keeps the brand, greeting, and question in the required left-to-right sequence', () => {
  const header = readFileSync(new URL('../components/AppHeader.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/validate/page.tsx', import.meta.url), 'utf8');

  assert.match(header, /<Link href="\/dashboard" className="app-brand"/);
  assert.match(header, /Good morning|Good afternoon|Good evening/);
  assert.match(header, /No trade without evidence\./);
  assert.match(header, /KeyboardShortcuts/);
  assert.match(header, /SignOutButton/);
  assert.match(page, /description="Should I take this trade\?"/);
  assert.match(page, /AppHeader/);
});

test('session-scoped strategy IDs are isolated per user and stale IDs are discarded', () => {
  const userA = 'user-a';
  const userB = 'user-b';
  const strategyIdA = 'strategy-aaa';
  const strategyIdB = 'strategy-bbb';

  assert.equal(getUserScopedStorageKey('trade-police:active-strategy', userA), 'trade-police:active-strategy:user-a');
  assert.equal(getUserScopedStorageKey('trade-police:active-strategy', userB), 'trade-police:active-strategy:user-b');
  assert.equal(isStrategySelectionOwnedByUser(strategyIdA, userA, [strategyIdA]), true);
  assert.equal(isStrategySelectionOwnedByUser(strategyIdA, userB, [strategyIdB]), false);

  const cleared = clearUserScopedSessionState(userA, { strategyId: strategyIdA, accountId: 'account-a' });
  assert.deepEqual(cleared, {
    strategyId: null,
    accountId: null,
  });
});
