import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const detail=read('components/StrategyDetailPage.tsx');
const exportRoute=read('app/api/backtests/[id]/export/route.ts');
const reportRoute=read('app/api/backtests/[id]/report/route.ts');
const outcome=read('lib/backtesting/backtest-report.ts');

test('completed zero-trade runs are classified from diagnostics instead of presented as blanket success',()=>{
  assert.match(detail,/backtestOutcome/);
  assert.doesNotMatch(detail,/Backtest completed successfully — no valid setup was found/);
  assert.match(outcome,/ZERO_NO_RULE_CONVERGENCE/);
  assert.match(outcome,/ZERO_ANALYSIS_ERRORS/);
  assert.match(detail,/total_trades[\s\S]*===0[\s\S]*'N\/A'/);
});

test('backtest reports offer Excel and printable PDF exports',()=>{
  assert.match(detail,/Download Excel/);
  assert.match(detail,/Open PDF Report/);
  assert.match(detail,/\/api\/backtests\/\$\{selectedRun\.id\}\/report/);
  assert.match(reportRoute,/window\.print\(\)/);
  assert.match(exportRoute,/new ExcelJS\.Workbook/);
  for(const sheet of ['Summary','Rule Diagnostics','Strategy Definition','Executable Rules','Methodology','Data Coverage','Candidates','Taken Trades','Rejected Trades','Aborted Trades','Override Scenarios','Performance','Equity Time Series','Run Metadata'])assert.match(exportRoute,new RegExp(`['"]${sheet}['"]`));
  assert.match(exportRoute,/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});

test('report export is authenticated, owner-scoped, and completed-only',()=>{
  for(const source of [exportRoute,reportRoute]){
    assert.match(source,/auth\.getUser\(\)/);
    assert.match(source,/\.eq\('id', id\)\.eq\('user_id', user\.id\)/);
    assert.match(source,/run\.status !== 'COMPLETED'/);
    assert.match(source,/private, no-store/);
    assert.match(source,/backtest_candidate_events/);
    assert.match(source,/\.eq\('run_id', id\)\.eq\('user_id', user\.id\)/);
  }
});

test('PDF report separates candidate gates from detector observations and avoids an empty trade ledger',()=>{
  assert.match(reportRoute,/Gate evaluated/);
  assert.match(reportRoute,/Raw detector observations/);
  assert.match(reportRoute,/Candidate evidence ledger/);
  assert.match(reportRoute,/No-trade analysis/);
  assert.match(reportRoute,/disable browser headers and footers/);
});
