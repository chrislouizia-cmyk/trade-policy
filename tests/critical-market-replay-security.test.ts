import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/103_secure_marketplace_metrics_and_provider_replays.sql');
const analyze=read('app/api/market/analyze/route.ts');
const entitlements=read('lib/billing/entitlements.ts');

test('verified marketplace metrics are server-owned behind forced RLS',()=>{
  assert.match(migration,/alter table public\.marketplace_release_verified_metrics enable row level security/);
  assert.match(migration,/alter table public\.marketplace_release_verified_metrics force row level security/);
  assert.match(migration,/revoke all on table public\.marketplace_release_verified_metrics from public, anon, authenticated/);
  assert.match(migration,/grant select, insert, update, delete on table public\.marketplace_release_verified_metrics to service_role/);
});

test('completed analysis requests replay their original scan before any provider call',()=>{
  const reserve=analyze.indexOf('reserveAnalysis(user.id,requestKey)');
  const replay=analyze.indexOf('completedAnalysisReplay(user.id');
  const provider=analyze.indexOf('const values = await withTwelveDataCredits');
  assert.ok(reserve>=0&&replay>reserve&&provider>replay);
  assert.match(analyze,/ANALYSIS_IN_PROGRESS/);
  assert.match(analyze,/ANALYSIS_REQUEST_REUSED/);
  assert.match(analyze,/finalizeAnalysis\(user\.id,requestKey,true,scan\.id\)/);
  assert.match(entitlements,/result_analysis_id/);
  assert.match(entitlements,/error\.code === '23505'/);
});

test('all interactive provider routes require explicit idempotency keys',()=>{
  for(const file of ['app/api/market/candles/route.ts','app/api/market/quote/route.ts','app/api/trades/price/route.ts','app/api/trades/reanalyze/route.ts']){
    const source=read(file);
    assert.match(source,/headers\.get\('idempotency-key'\)/,file);
    assert.match(source,/IDEMPOTENCY_KEY_REQUIRED/,file);
    assert.doesNotMatch(source,/\?\?Date\.now\(\)/,file);
  }
  const monitor=read('components/ActiveTradeMonitor.tsx');
  const candles=read('components/useMarketCandles.ts');
  assert.match(monitor,/'Idempotency-Key':crypto\.randomUUID\(\)/);
  assert.match(candles,/'Idempotency-Key':crypto\.randomUUID\(\)/);
});

test('opening Decision remains provider-free and snapshot-only',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  const snapshot=read('app/api/market/snapshot/route.ts');
  assert.match(panel,/fetch\(`\/api\/market\/snapshot\?/);
  assert.doesNotMatch(snapshot,/withTwelveDataCredits|fetchSeries|fetchPrice/);
  assert.doesNotMatch(panel,/snapshot[\s\S]{0,300}scan\(/);
});
