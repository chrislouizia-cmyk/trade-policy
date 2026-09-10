import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const builder = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../app/api/strategies/delete/route.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/107_repair_strategy_hard_delete.sql', import.meta.url), 'utf8');

test('strategy lifecycle keeps archive separate from permanent delete', () => {
  for (const action of ['Edit', 'Duplicate', 'Archive', 'Restore', 'Delete strategy']) {
    assert.match(builder, new RegExp(`w\\('${action.replace(/\s+/g, ' ')}'\\)`));
  }
  assert.match(builder, /Type <strong>DELETE<\/strong> to confirm/);
  assert.match(builder, /permanently removes the strategy/);
});

test('delete endpoint delegates permanent deletion to the canonical database function', () => {
  assert.match(route, /z\.literal\(['"]DELETE['"]\)/);
  assert.match(route, /\.rpc\(['"]delete_strategy_playbook['"]/);
  assert.doesNotMatch(route, /update\(\{\s*is_archived:\s*true/);
  assert.match(route, /result\.deleted !== true/);
});

test('database delete is ownership scoped and actually removes the strategy row', () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /where id = p_strategy_id\s+and user_id = v_user_id/);
  assert.match(migration, /delete from public\.strategy_profiles/);
  assert.match(migration, /'deleted', true/);
});

test('historical trading truth is preserved before strategy deletion', () => {
  for (const table of ['trade_records', 'active_trades', 'market_scans']) {
    assert.match(migration, new RegExp(`update public\\.${table}`));
  }
  assert.match(migration, /set strategy_profile_id = null/);
  assert.doesNotMatch(migration, /delete from public\.(trade_records|active_trades|market_scans)/);
});

test('deleting the active strategy selects a safe fallback when one exists', () => {
  assert.match(migration, /if v_strategy\.is_default then/);
  assert.match(migration, /id <> p_strategy_id/);
  assert.match(migration, /is_archived = false/);
  assert.match(migration, /set is_default = true/);
  assert.match(migration, /'fallbackStrategyId', v_fallback_strategy_id/);
  assert.doesNotMatch(builder, /Delete strategy'\)<\/button>.*disabled=\{selectedProfile\.isDefault\}/);
});

test('delete telemetry captures the id before clearing modal state', () => {
  const capture = builder.indexOf('const deletedId = deleteTarget.id');
  const clear = builder.indexOf('setDeleteTarget(null)', capture);
  const track = builder.indexOf("trackBetaEvent('PLAYBOOK_DELETED', deletedId)", clear);
  assert.ok(capture >= 0 && clear > capture && track > clear);
});

test('backtests survive source strategy deletion through their immutable snapshot', () => {
  assert.match(migration, /alter column strategy_profile_id drop not null/);
  assert.match(migration, /backtest_runs_strategy_profile_id_fkey/);
  assert.match(migration, /on delete set null/);
  assert.match(migration, /update public\.backtest_runs/);
});

test('immutable Marketplace releases block source deletion instead of being silently corrupted', () => {
  assert.match(migration, /marketplace_strategy_releases/);
  assert.match(migration, /Marketplace release/);
  assert.doesNotMatch(migration, /delete from public\.marketplace_strategy_releases/);
});
