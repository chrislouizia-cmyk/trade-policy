import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isCountableDailyTradeExecution } from '../lib/server/daily-trade-context.ts';
import { assertValidInternalLifecycleSourceIds, buildInternalLifecycleDecisionSnapshot, getInternalLifecycleScenarioConfig } from '../lib/server/internal-lifecycle-lineage.ts';
import { attachTradeLifecycleSimulationMetadata, isTradeLifecycleSimulationRequest, isTradeLifecycleSimulationRecord } from '../lib/server/trade-lifecycle-v2.ts';

const activateRoute = readFileSync(new URL('../app/api/trades/activate/route.ts', import.meta.url), 'utf8');
const closeRoute = readFileSync(new URL('../app/api/trades/[id]/close/route.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/073_trade_lifecycle_v2_rpcs.sql', import.meta.url), 'utf8');
const historicalDecisionReportsMigration = readFileSync(new URL('../supabase/migrations/042_historical_decision_reports.sql', import.meta.url), 'utf8');
const productionTradeRecordColumns = [
  'user_id',
  'source',
  'status',
  'instrument',
  'direction',
  'setup_type',
  'session',
  'entry',
  'stop_loss',
  'take_profit',
  'rr',
  'score',
  'verdict',
  'chart_analysis',
  'rule_snapshot',
  'created_at',
  'updated_at',
  'account_id',
  'balance_at_entry',
  'risk_amount',
  'strategy_profile_id',
  'strategy_name_at_entry'
];
const invalidTradeRecordLifecycleColumns = [
  'strategy_snapshot',
  'original_verdict',
  'original_verdict_reason',
  'taken_against_verdict',
  'override_reason',
  'override_conditions',
  'activation_mode',
  'strategy_revision_id',
  'source_decision_id',
  'source_report_id'
];

test('activate_trade_v2 is defined as a server-owned service-role RPC with correct exposure', () => {
  assert.match(migration, /create or replace function public\.activate_trade_v2\(/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /owner to postgres/i);
  assert.match(migration, /revoke all on function public\.activate_trade_v2\(/i);
  assert.match(migration, /revoke execute on function public\.activate_trade_v2\(/i);
  assert.match(migration, /grant execute on function public\.activate_trade_v2\(/i);
  assert.match(migration, /to service_role/i);
  assert.doesNotMatch(migration, /to authenticated/i);
  assert.doesNotMatch(migration, /to anon/i);
  assert.match(migration, /active_trades_user_source_decision_unique/i);
});

test('close_trade_v2 is defined as a server-owned service-role RPC with duplicate close protection', () => {
  assert.match(migration, /create or replace function public\.close_trade_v2\(/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /already_closed/i);
  assert.match(migration, /insert into public\.active_trade_events/i);
  assert.match(migration, /grant execute on function public\.close_trade_v2\(/i);
  assert.match(migration, /to service_role/i);
  assert.doesNotMatch(migration, /to authenticated/i);
});

test('activate route is server-only and uses service-role V2 RPC', () => {
  assert.match(activateRoute, /const admin = createAdminClient\(\);/);
  assert.match(activateRoute, /admin\.rpc\('activate_trade_v2'/);
  assert.match(activateRoute, /TRADE_LIFECYCLE_V2_DISABLED/);
  assert.match(activateRoute, /auth\.getUser\(\)/);
  assert.doesNotMatch(activateRoute, /insert\s+into\s+public\.active_trades/i);
});

test('trade_records insert matches the real production schema contract and excludes lifecycle-only fields', () => {
  const tradeRecordsInsert = migration.match(/insert into public\.trade_records\s*\(([\s\S]*?)\)\s*values\s*\(/i)?.[1] ?? '';
  const tradeRecordsValues = migration.match(/values\s*\(([\s\S]*?)\)\s*returning id into v_trade_record_id;/i)?.[1] ?? '';
  const tradeRecordsColumns = tradeRecordsInsert
    .split(',')
    .map((column) => column.trim().toLowerCase())
    .filter(Boolean);

  for (const invalidColumn of invalidTradeRecordLifecycleColumns) {
    assert.doesNotMatch(tradeRecordsInsert, new RegExp(`\\b${invalidColumn}\\b`, 'i'));
  }

  for (const validColumn of productionTradeRecordColumns) {
    assert.ok(tradeRecordsColumns.includes(validColumn), `${validColumn} should be present in the trade_records insert`);
  }

  assert.match(tradeRecordsInsert, /\brule_snapshot\b/i);
  assert.match(tradeRecordsValues, /p_strategy_snapshot/i);
  assert.equal((tradeRecordsValues.match(/\bp_strategy_snapshot\b/g) ?? []).length, 1);
  assert.match(migration, /insert into public\.active_trades[\s\S]*strategy_snapshot[\s\S]*p_strategy_snapshot/i);
});

test('close_trade_v2 updates only production-safe trade_records fields', () => {
  const closeUpdateBlock = migration.match(/update\s+public\.trade_records\s*set\s*([\s\S]*?)\s*where\s+id\s*=\s*v_trade\.trade_record_id/i)?.[0] ?? '';
  const validCloseFields = [
    'status',
    'outcome',
    'result_r',
    'closed_at',
    'realized_pnl',
    'fees',
    'updated_at'
  ];

  for (const field of validCloseFields) {
    assert.match(closeUpdateBlock, new RegExp(`\\b${field}\\b`, 'i'));
  }

  for (const invalidField of invalidTradeRecordLifecycleColumns) {
    assert.doesNotMatch(closeUpdateBlock, new RegExp(`\\b${invalidField}\\b`, 'i'));
  }
});

test('close route is server-only and uses service-role V2 close RPC', () => {
  assert.match(closeRoute, /const admin = createAdminClient\(\);/);
  assert.match(closeRoute, /admin\.rpc\('close_trade_v2'/);
  assert.match(closeRoute, /TRADE_LIFECYCLE_V2_DISABLED/);
  assert.match(closeRoute, /auth\.getUser\(\)/);
  assert.doesNotMatch(closeRoute, /update\s+public\.active_trades/i);
});

test('the V2 contract preserves lifecycle semantics expected by the working behavior', () => {
  assert.match(migration, /p_activation_mode.*'OVERRIDE'/i);
  assert.match(migration, /p_taken_against_verdict or p_activation_mode = 'OVERRIDE'/i);
  assert.match(migration, /insert into public\.trade_records/i);
  assert.match(migration, /insert into public\.active_trades/i);
  assert.match(migration, /insert into public\.active_trade_events/i);
  assert.match(migration, /source_decision_id is not null/i);
});

test('hard blocks cannot be overridden at the RPC contract boundary', () => {
  assert.match(migration, /This decision is hard-blocked and cannot be overridden\./i);
  assert.match(migration, /v_report_override_eligible/i);
  assert.match(migration, /elsif v_report_override_eligible then/i);
  assert.match(migration, /This decision is hard-blocked and cannot be overridden\./i);
});

test('caller cannot forge override eligibility or verdict at the RPC boundary', () => {
  assert.match(migration, /Caller supplied original verdict does not match the authoritative decision report verdict\./i);
  assert.match(migration, /coalesce\(p_original_verdict, v_report_verdict\)/i);
  assert.match(migration, /override activation requires authoritative override eligibility and a non-empty reason\./i);
});

test('risk amount stays monetary and is not reused as risk percent in the RPC', () => {
  assert.match(migration, /Caller-supplied risk_amount is not permitted for account-backed activation\./i);
  assert.match(migration, /v_risk_amount_value := v_balance_at_entry_value \* \(p_risk_percent \/ 100\.0\)/i);
  assert.match(migration, /Risk percent must be greater than zero for account-backed activation\./i);
  assert.match(migration, /v_risk_amount_value/i);
  assert.doesNotMatch(migration, /risk_amount\s*:=\s*p_risk_percent/i);
  assert.doesNotMatch(migration, /risk_amount\s*:=\s*coalesce\(p_risk_percent/i);
});

test('duplicate activation resolves idempotently under concurrent race conditions', () => {
  assert.match(migration, /on conflict \(user_id, source_decision_id\)/i);
  assert.match(migration, /do nothing/i);
  assert.match(migration, /Duplicate activation race detected\./i);
  assert.match(migration, /duplicate', true/i);
});

test('close trade P&L uses the monetary risk basis rather than percentage risk', () => {
  assert.match(migration, /v_realized_pnl := \(coalesce\(v_trade\.risk_amount, 0\) \* v_result_r\)/i);
  assert.match(migration, /realized_pnl = v_realized_pnl/i);
  assert.doesNotMatch(migration, /risk_percent.*v_result_r/i);
});

test('forged risk_amount cannot alter monetary risk for account-backed activation', () => {
  assert.match(migration, /Caller-supplied risk_amount is not permitted for account-backed activation\./i);
  assert.match(migration, /select a\.current_balance/i);
  assert.match(migration, /v_risk_amount_value := v_balance_at_entry_value \* \(p_risk_percent \/ 100\.0\)/i);
});

test('zero or negative risk is rejected', () => {
  assert.match(migration, /p_risk_percent is null or p_risk_percent <= 0/i);
  assert.match(migration, /Calculated risk amount must be greater than zero\./i);
  assert.match(migration, /Invalid monetary risk basis for account-backed activation\./i);
});

test('losing trade cannot be closed as win', () => {
  assert.match(migration, /v_close_outcome := case/i);
  assert.match(migration, /Close outcome conflicts with the calculated result\./i);
  assert.match(migration, /p_outcome is not null and lower\(trim\(p_outcome\)\) <> lower\(v_close_outcome\)/i);
});

test('READY cannot activate as OVERRIDE', () => {
  assert.match(migration, /if v_report_verdict in \('READY', 'AUTHORIZED'\) then/i);
  assert.match(migration, /READY\/AUTHORIZED assertions require READY activation mode\./i);
});

test('soft block can OVERRIDE and hard block cannot', () => {
  assert.match(migration, /elsif v_report_override_eligible then/i);
  assert.match(migration, /This decision is hard-blocked and cannot be overridden\./i);
  assert.match(migration, /Override activation requires a non-empty override reason\./i);
});

test('authoritative snapshot location matches production persistence code', () => {
  assert.match(migration, /select ds\.snapshot_json/i);
  assert.match(migration, /from public\.decision_report_sources ds/i);
  assert.match(migration, /v_report_snapshot := v_source_snapshot/i);
  assert.match(historicalDecisionReportsMigration, /save_decision_report\(p_source_id uuid,p_user_id uuid,p_idempotency_key text\)/i);
  assert.match(historicalDecisionReportsMigration, /snapshot_json jsonb not null/i);
});

test('internal lifecycle seed reuses the canonical production report persistence contract', () => {
  const seedRoute = readFileSync(new URL('../app/api/internal/lifecycle-test/seed/route.ts', import.meta.url), 'utf8');

  assert.match(seedRoute, /admin\.from\('decision_report_sources'\)\.insert\(/i);
  assert.match(seedRoute, /save_decision_report/i);
  assert.match(seedRoute, /p_source_id: sourceId/i);
  assert.match(seedRoute, /p_user_id: user\.id/i);
  assert.match(seedRoute, /p_idempotency_key: idempotencyKey/i);
  assert.doesNotMatch(seedRoute, /from\('decision_reports'\)\.insert\(/i);
});

test('internal lifecycle lab uses account-backed activation instead of manual balance fields', () => {
  const harness = readFileSync(new URL('../components/admin/LifecycleTestHarness.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/admin/lifecycle-test/page.tsx', import.meta.url), 'utf8');

  assert.match(harness, /accountId: selectedAccountId/i);
  assert.match(harness, /riskPercent: Number\(payload\.riskPercent\)/i);
  assert.doesNotMatch(harness, /balanceAtEntry/i);
  assert.doesNotMatch(harness, /riskAmount/i);
  assert.match(harness, /No active trading account is available for Lifecycle V2 simulation\./i);
  assert.match(page, /from\('trading_accounts'\)/i);
  assert.match(page, /eq\('is_archived', false\)/i);
  assert.match(migration, /Manual activation requires a valid balance_at_entry\./i);
});

test('internal smoke mode is gated behind a dedicated server flag and internal request signal', () => {
  const previous = process.env.TRADE_LIFECYCLE_V2_SIMULATION;
  process.env.TRADE_LIFECYCLE_V2_SIMULATION = 'true';

  try {
    const request = new Request('https://tradepolice.app/api/trades/activate?internal_test=1');
    assert.equal(isTradeLifecycleSimulationRequest(request), true);
    assert.deepEqual(attachTradeLifecycleSimulationMetadata({ existing: true }), {
      existing: true,
      simulationMode: 'INTERNAL_LIFECYCLE_SMOKE_TEST',
      internalTestMode: true,
      testSource: 'INTERNAL_LIFECYCLE_SMOKE_TEST',
    });
  } finally {
    if (previous === undefined) {
      delete process.env.TRADE_LIFECYCLE_V2_SIMULATION;
    } else {
      process.env.TRADE_LIFECYCLE_V2_SIMULATION = previous;
    }
  }
});

test('simulation metadata is excluded from countable live execution totals', () => {
  const simulationRow = {
    id: 'trade-123',
    source: 'EXECUTED',
    status: 'OPEN',
    instrument: 'XAUUSD',
    created_at: '2026-08-21T12:00:00.000Z',
    strategy_profile_id: 'strategy-a',
    strategy_snapshot: { simulationMode: 'INTERNAL_LIFECYCLE_SMOKE_TEST' },
  };

  assert.equal(isCountableDailyTradeExecution(simulationRow, new Set(['trade-123'])), false);
  assert.equal(isTradeLifecycleSimulationRecord(simulationRow), true);
});

test('route payload keeps the authoritative lifecycle contract while tagging internal simulation metadata', () => {
  assert.match(activateRoute, /isTradeLifecycleSimulationRequest\(request\)/i);
  assert.match(activateRoute, /attachTradeLifecycleSimulationMetadata\(/i);
  assert.match(activateRoute, /p_strategy_snapshot: strategySnapshot/i);
  assert.doesNotMatch(activateRoute, /p_simulation_mode/i);
  assert.doesNotMatch(activateRoute, /p_source.*simulation/i);
});

test('simulation records are explicitly labeled and kept out of live history and analytics views', () => {
  const historyPage = readFileSync(new URL('../app/history/page.tsx', import.meta.url), 'utf8');
  const analyticsPage = readFileSync(new URL('../app/analytics/page.tsx', import.meta.url), 'utf8');

  assert.match(historyPage, /SIMULATION\/ INTERNAL TEST|SIMULATION.*INTERNAL TEST/i);
  assert.match(analyticsPage, /SIMULATION\/ INTERNAL TEST|SIMULATION.*INTERNAL TEST/i);
  assert.match(historyPage, /strategy_snapshot.*simulationMode|simulationMode.*strategy_snapshot/i);
  assert.match(analyticsPage, /strategy_snapshot.*simulationMode|simulationMode.*strategy_snapshot/i);
  assert.doesNotMatch(historyPage, /decision_reports\).*select\('id,created_at.*snapshot_json'\)|select\('id,created_at.*snapshot_json'\)/i);
  assert.doesNotMatch(analyticsPage, /\.from\('active_trades'\)\.select\(.*\)\.eq\('status','CLOSED'\)/i);
});

test('internal lifecycle scenarios produce authoritative READY, SOFT, and HARD decision lineage snapshots', () => {
  const ready = buildInternalLifecycleDecisionSnapshot('READY');
  const soft = buildInternalLifecycleDecisionSnapshot('SOFT_BLOCK');
  const hard = buildInternalLifecycleDecisionSnapshot('HARD_BLOCK');

  assert.equal(ready.verdict, 'READY');
  assert.equal(ready.finalRiskCheck.overrideEligible, false);
  assert.equal(getInternalLifecycleScenarioConfig('READY').activationMode, 'READY');

  assert.equal(soft.verdict, 'BLOCKED');
  assert.equal(soft.finalRiskCheck.overrideEligible, true);
  assert.equal(getInternalLifecycleScenarioConfig('SOFT_BLOCK').activationMode, 'OVERRIDE');

  assert.equal(hard.verdict, 'BLOCKED');
  assert.equal(hard.finalRiskCheck.overrideEligible, false);
  assert.equal(getInternalLifecycleScenarioConfig('HARD_BLOCK').activationMode, 'READY');
});

test('fake or blank internal IDs are rejected before they can reach the V2 RPC', () => {
  assert.throws(() => assertValidInternalLifecycleSourceIds('', '3f5ec9af-9fd9-4ab4-a50e-7740dbb2823b'), /A valid internal smoke test sourceDecisionId and sourceReportId are required/i);
  assert.throws(() => assertValidInternalLifecycleSourceIds('not-a-uuid', '3f5ec9af-9fd9-4ab4-a50e-7740dbb2823b'), /sourceDecisionId must be a valid UUID/i);
  assert.throws(() => assertValidInternalLifecycleSourceIds('3f5ec9af-9fd9-4ab4-a50e-7740dbb2823b', 'not-a-uuid'), /sourceReportId must be a valid UUID/i);
  assert.doesNotThrow(() => assertValidInternalLifecycleSourceIds('3f5ec9af-9fd9-4ab4-a50e-7740dbb2823b', '1ebd5d9c-b7af-4f99-b4cd-c2d51f1d8f3f'));
});
