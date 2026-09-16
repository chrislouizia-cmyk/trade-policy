import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reconcileStrategyDeletion } from '../lib/strategy-deletion-state.ts';

const route = readFileSync(new URL('../app/api/strategies/delete/route.ts', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/107_repair_strategy_hard_delete.sql', import.meta.url), 'utf8');

test('deleting an unrelated strategy preserves selected and active strategy state', () => {
  assert.deepEqual(reconcileStrategyDeletion({
    deletedStrategyId: 'deleted',
    fallbackStrategyId: null,
    selectedStrategyId: 'selected',
    deletedWasActive: false,
  }), {
    selectedWasDeleted: false,
    nextSelectedStrategyId: 'selected',
    nextActiveStrategyId: undefined,
  });
});

test('deleting the selected active strategy applies the server fallback', () => {
  assert.deepEqual(reconcileStrategyDeletion({
    deletedStrategyId: 'deleted',
    fallbackStrategyId: 'fallback',
    selectedStrategyId: 'deleted',
    deletedWasActive: true,
  }), {
    selectedWasDeleted: true,
    nextSelectedStrategyId: 'fallback',
    nextActiveStrategyId: 'fallback',
  });
});

test('deleting the final active strategy produces a valid empty state', () => {
  assert.deepEqual(reconcileStrategyDeletion({
    deletedStrategyId: 'only',
    fallbackStrategyId: null,
    selectedStrategyId: 'only',
    deletedWasActive: true,
  }), {
    selectedWasDeleted: true,
    nextSelectedStrategyId: null,
    nextActiveStrategyId: null,
  });
});

test('delete removes the item immediately, refetches canonical data and invalidates routes', () => {
  assert.match(builder, /setProfiles\(\(current\) => current\.filter\(\(item\) => item\.id !== deletedId\)\)/);
  assert.match(builder, /loadAll\(resolution\.nextSelectedStrategyId/);
  assert.match(builder, /window\.history\.replaceState/);
  assert.match(builder, /router\.refresh\(\)/);
  assert.match(route, /revalidatePath\('\/profile'\)/);
});

test('hard delete remains server-authorized and preserves historical evidence', () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /\.eq\('user_id', user\.id\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /auth\.uid\(\)/);
  for (const table of ['trade_records', 'active_trades', 'market_scans', 'decision_reports', 'backtest_runs']) {
    assert.match(migration, new RegExp(`update public\\.${table}`));
    assert.doesNotMatch(migration, new RegExp(`delete from public\\.${table}`));
  }
});
