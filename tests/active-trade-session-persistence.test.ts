import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const validator=read('components/TradeValidator.tsx');
const monitor=read('components/ActiveTradeMonitor.tsx');
const takeRoute=read('app/api/trades/take/route.ts');
const reanalysisRoute=read('app/api/trades/reanalyze/route.ts');
const migration=read('supabase/migrations/088_persist_atomic_trade_session.sql');

test('trade activation sends and validates the selected strategy session',()=>{
  assert.match(validator,/session:get\('session'\)/);
  assert.match(takeRoute,/const session = typeof body\.session === 'string' \? body\.session\.trim\(\) : ''/);
  assert.match(takeRoute,/from\('strategy_profiles'\)\.select\('allowed_sessions'\)\.eq\('id',body\.strategyProfileId\)\.eq\('user_id',user\.id\)/);
  assert.match(takeRoute,/allowedSessions\.includes\(session\)/);
  assert.match(takeRoute,/p_session: session/);
  assert.match(takeRoute,/p_strategy_snapshot:[\s\S]*tradeContext:[\s\S]*session,/);
});

test('atomic activation persists session without exposing the rpc to customer roles',()=>{
  assert.match(migration,/create or replace function public\.activate_trade_atomically_v1\([\s\S]*p_session text/);
  assert.match(migration,/for update/);
  assert.match(migration,/set session = btrim\(p_session\)/);
  assert.match(migration,/revoke all on function public\.activate_trade_atomically_v1\([\s\S]*from public, anon, authenticated/);
  assert.match(migration,/grant execute on function public\.activate_trade_atomically_v1\([\s\S]*to service_role/);
  assert.doesNotMatch(migration,/to authenticated/);
});

test('legacy active trades require an explicit original session and repair both records',()=>{
  assert.match(reanalysisRoute,/session:z\.string\(\)\.trim\(\)\.min\(1\)\.max\(80\)\.optional\(\)/);
  assert.match(reanalysisRoute,/MISSING_TRADE_SESSION[\s\S]*allowedSessions:policy\.allowedSessions/);
  assert.match(reanalysisRoute,/from\('trade_records'\)\.update\(\{session,updated_at:guidance\.generatedAt\}\)/);
  assert.match(reanalysisRoute,/strategy_snapshot:repairedSnapshot/);
  assert.match(monitor,/c\.restore/);
  assert.match(monitor,/session:sessionRepair/);
  assert.match(monitor,/needsSessionRepair&&!sessionRepair/);
});
