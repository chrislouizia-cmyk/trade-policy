import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const detail=read('components/StrategyDetailPage.tsx');
const exportRoute=read('app/api/backtests/[id]/export/route.ts');

test('completed zero-trade runs are explicitly successful but have unavailable performance metrics',()=>{
  assert.match(detail,/Backtest completed successfully — no valid setup was found/);
  assert.match(detail,/does not mean the backtest failed/);
  assert.match(detail,/total_trades[\s\S]*===0[\s\S]*'N\/A'/);
});

test('backtest reports offer Excel and printable PDF exports',()=>{
  assert.match(detail,/Download Excel/);
  assert.match(detail,/Print \/ Save PDF/);
  assert.match(detail,/window\.print\(\)/);
  assert.match(exportRoute,/new ExcelJS\.Workbook/);
  assert.match(exportRoute,/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});

test('report export is authenticated, owner-scoped, and completed-only',()=>{
  assert.match(exportRoute,/auth\.getUser\(\)/);
  assert.match(exportRoute,/\.eq\('id',id\)\.eq\('user_id',user\.id\)/);
  assert.match(exportRoute,/run\.status!=='COMPLETED'/);
  assert.match(exportRoute,/Cache-Control':'private, no-store/);
});
