import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';

import { buildActiveTradeRow } from '../lib/server/trade-activation.ts';
import { strategyRevisionId } from '../lib/historical-decisions/strategy-revision.ts';
import { DEFAULT_STRATEGY_PROFILE } from '../types/trade.ts';

test('active_trades strategy_revision_id contract matches the app and migration', () => {
  const revision = strategyRevisionId(DEFAULT_STRATEGY_PROFILE);
  assert.match(revision, /^\d+:[a-f0-9]{64}$/);

  const row = buildActiveTradeRow({
    userId: '11111111-1111-4111-8111-111111111111',
    strategyProfileId: '22222222-2222-4222-8222-222222222222',
    strategyNameAtEntry: 'Chris Core Strategy',
    strategyRevisionId: revision,
    instrument: 'XAUUSD',
    direction: 'BUY',
    entry: 2100,
    stopLoss: 2090,
    takeProfit: 2140,
    riskPercent: 0.5,
    initialRR: 4,
    activationMode: 'READY',
  });

  assert.equal(row.strategy_revision_id, revision);
  assert.equal(typeof row.strategy_revision_id, 'string');

  const historicalRow = buildActiveTradeRow({
    userId: '33333333-3333-4333-8333-333333333333',
    instrument: 'GBPUSD',
    direction: 'SELL',
    entry: 1.27,
    stopLoss: 1.285,
    takeProfit: 1.25,
    riskPercent: 0.5,
    initialRR: 3,
  });

  assert.equal(historicalRow.strategy_revision_id, null);

  const migrationPath = new URL('../supabase/migrations/068_active_trades_strategy_revision_id.sql', import.meta.url);
  assert.equal(existsSync(migrationPath), true, 'active_trades strategy_revision_id migration should exist');

  const migrationSql = readFileSync(migrationPath, 'utf8');
  assert.match(migrationSql, /alter table public\.active_trades\s+add column if not exists strategy_revision_id text;/i);
  assert.doesNotMatch(migrationSql, /references public\.strategy_profiles|foreign key|create index if not exists.*strategy_revision_id/i);
  assert.match(migrationSql, /notify pgrst, 'reload schema';/i);

  const routeSource = readFileSync(new URL('../app/api/trades/take/route.ts', import.meta.url), 'utf8');
  assert.match(routeSource, /p_strategy_revision_id:\s*typeof body\.strategySnapshot\?\.revisionId === 'string' \? body\.strategySnapshot\.revisionId : null/i);

  const historicalRowsRemainValid = buildActiveTradeRow({
    userId: '44444444-4444-4444-8444-444444444444',
    instrument: 'EURUSD',
    direction: 'BUY',
    entry: 1.1,
    stopLoss: 1.09,
    takeProfit: 1.13,
    riskPercent: 0.5,
    initialRR: 3,
  });

  assert.equal(historicalRowsRemainValid.strategy_revision_id, null);
  assert.equal(historicalRowsRemainValid.strategy_revision_id, null);
});
