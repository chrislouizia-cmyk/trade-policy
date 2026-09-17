import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { reconcileStrategyDeletion } from '../lib/strategy-deletion-state.ts';

const route = readFileSync(new URL('../app/api/strategies/delete/route.ts', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/107_repair_strategy_hard_delete.sql', import.meta.url), 'utf8');
const immutableHistoryRepair = readFileSync(new URL('../supabase/migrations/20260917061002_allow_strategy_delete_to_detach_immutable_history.sql', import.meta.url), 'utf8');
const marketplaceGuardRepair = readFileSync(new URL('../supabase/migrations/20260917062358_repair_strategy_delete_marketplace_guard.sql', import.meta.url), 'utf8');

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

test('delete confirmation dialog is mounted from the selected-strategy branch', () => {
  assert.match(builder, /const deleteDialog = deleteTarget/);
  const selectedBranch = builder.slice(
    builder.indexOf('if (selectedProfile) {'),
    builder.indexOf("return (\n    <div className=\"strategy-builder-layout\">", builder.indexOf('if (selectedProfile) {')),
  );
  assert.match(selectedBranch, /\{deleteDialog\}/);
  assert.doesNotMatch(builder, /deleteTarget&&createPortal/);
});

test('hard delete remains server-authorized and preserves historical evidence', () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /\.eq\('user_id', user\.id\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /auth\.uid\(\)/);
  for (const table of ['trade_records', 'active_trades', 'market_scans', 'backtest_runs']) {
    assert.match(migration, new RegExp(`update public\\.${table}`));
    assert.doesNotMatch(migration, new RegExp(`delete from public\\.${table}`));
  }
  assert.doesNotMatch(immutableHistoryRepair, /delete from public\.decision_reports/);
});

test('immutable Decision Reports detach only through the strategy FK delete', () => {
  assert.match(immutableHistoryRepair, /old\.strategy_id is not null/);
  assert.match(immutableHistoryRepair, /new\.strategy_id is null/);
  assert.match(immutableHistoryRepair, /to_jsonb\(new\) - 'strategy_id'/);
  assert.match(immutableHistoryRepair, /not exists[\s\S]*from public\.strategy_profiles/);
  assert.match(immutableHistoryRepair, /select count\(\*\)::integer[\s\S]*from public\.decision_reports/);
  assert.doesNotMatch(immutableHistoryRepair, /update public\.decision_reports/);
});

test('delete failures are visible inside the confirmation dialog', () => {
  assert.match(builder, /readApiResponse\(response\)/);
  assert.match(builder, /setDeleteError\(nextError\)/);
  assert.match(builder, /role="alert">\{deleteError\}/);
});

test('delete does not require authenticated access to protected Marketplace release tables', () => {
  assert.match(marketplaceGuardRepair, /security invoker/);
  assert.doesNotMatch(marketplaceGuardRepair, /from public\.marketplace_strategy_releases/);
  assert.doesNotMatch(marketplaceGuardRepair, /grant select on (?:table )?public\.marketplace_strategy_releases to authenticated/);
  assert.match(marketplaceGuardRepair, /when foreign_key_violation/);
  assert.match(marketplaceGuardRepair, /v_constraint_name like 'marketplace_%'/);
  assert.match(marketplaceGuardRepair, /Marketplace release/);
});
