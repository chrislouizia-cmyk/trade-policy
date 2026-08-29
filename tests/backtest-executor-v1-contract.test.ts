import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const createRoute = fs.readFileSync('app/api/backtests/route.ts', 'utf8');
const executeRoute = fs.readFileSync('app/api/backtests/[id]/execute/route.ts', 'utf8');
const executor = fs.readFileSync('lib/server/backtest-executor.ts', 'utf8');
const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');
const css = fs.readFileSync('components/StrategyDetailPage.module.css', 'utf8');
const analysis = fs.readFileSync('lib/market-analysis.ts', 'utf8');

test('new backtests freeze authoritative normalized strategies including rules', () => {
  assert.match(createRoute, /loadStrategyById/);
  assert.match(createRoute, /freezeStrategyForBacktest\(strategy\)/);
  assert.doesNotMatch(createRoute, /freezeStrategyForBacktest\(strategy as any\)/);
});

test('executor owns queued running completed failed lifecycle', () => {
  assert.match(executeRoute, /backtest_claim_run_atomic/);
  assert.match(executeRoute, /backtest_complete_run_atomic/);
  assert.match(executeRoute, /backtest_fail_run_atomic/);
  assert.match(executeRoute, /prepareHistoricalBacktestData/);
  assert.match(executeRoute, /simulateBacktestFromSeries/);
});

test('executor uses historical Twelve Data and deterministic Trade Police analysis', () => {
  assert.match(executor, /api\.twelvedata\.com\/time_series/);
  assert.match(executor, /buildLiveAnalysis/);
  assert.match(executor, /setupReadiness\.state !== 'READY'/);
  assert.match(executor, /STOP_FIRST/);
  assert.match(executor, /OHLC_NO_HISTORICAL_SPREAD_DATA/);
});

test('unsupported required evidence fails rather than being silently invented', () => {
  assert.match(executor, /Automated backtesting cannot verify required/);
  assert.match(executor, /Automatic historical detector not available/);
});

test('historical analysis has explicit replay clock without changing live default behavior', () => {
  assert.match(analysis, /referenceTimeMs=Date\.now\(\)/);
  assert.match(analysis, /analysisAt\?:string/);
  assert.match(analysis, /new Date\(analysisTimeMs\)\.toISOString\(\)/);
});

test('strategy tabs use one fixed full-width desktop frame', () => {
  assert.match(detail, /className="strategy-detail-shell"/);
  assert.match(css, /height: 560px/);
  assert.match(css, /strategy-detail-backtests-stack/);
  assert.match(css, /max-width: none !important/);
});

test('queued runs have execution action instead of passive check status', () => {
  assert.match(detail, /executeQueuedRun/);
  assert.match(detail, /'Run now'/);
  assert.match(detail, /'Refresh status'/);
});
