import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

import {
  deriveMarketplaceRecordedTradeMetrics,
  marketplaceTradeOutcome,
} from '../lib/marketplace/recorded-trade-metrics.ts';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/104_repair_marketplace_metric_integrity.sql');
const observation=read('lib/server/marketplace-observation.ts');
const lab=read('components/hq/MarketplaceLab.tsx');
const detail=read('components/hq/MarketplaceReleaseDetail.tsx');
const detailRoute=read('app/api/hq/marketplace/[listingId]/route.ts');

test('recorded trade outcomes use the same 0.05R boundary as close_trade_v2',()=>{
  assert.equal(marketplaceTradeOutcome(0.051),'WIN');
  assert.equal(marketplaceTradeOutcome(0.05),'BREAKEVEN');
  assert.equal(marketplaceTradeOutcome(-0.05),'BREAKEVEN');
  assert.equal(marketplaceTradeOutcome(-0.051),'LOSS');
});

test('marketplace metrics calculate drawdown, streaks, rates, and adherence from one ordered series',()=>{
  const values=[-1,-1,0,2,1,-0.5];
  const metrics=deriveMarketplaceRecordedTradeMetrics(values.map((resultR,index)=>({
    id:String(index),closedAt:new Date(Date.UTC(2026,8,index+1)).toISOString(),resultR,takenAgainstVerdict:index===5,
  })));
  assert.deepEqual({trades:metrics.tradeCount,wins:metrics.wins,losses:metrics.losses,breakeven:metrics.breakeven},{trades:6,wins:2,losses:3,breakeven:1});
  assert.equal(metrics.totalR,0.5);
  assert.equal(metrics.averageR,0.0833);
  assert.equal(metrics.winRate,33.33);
  assert.equal(metrics.profitFactor,1.2);
  assert.equal(metrics.maxDrawdownR,2);
  assert.equal(metrics.maxWinStreak,2);
  assert.equal(metrics.maxLossStreak,2);
  assert.equal(metrics.adherencePercent,83.33);
  assert.equal(metrics.ruleViolationCount,1);
});

test('an empty series remains unavailable instead of fabricating zero performance',()=>{
  const metrics=deriveMarketplaceRecordedTradeMetrics([]);
  assert.equal(metrics.tradeCount,0);
  for(const value of [metrics.totalR,metrics.averageR,metrics.expectancyR,metrics.profitFactor,metrics.maxDrawdownR,metrics.winRate])assert.equal(value,null);
  assert.deepEqual(metrics.equityCurve,[]);
});

test('only the current exact revision appears in the active qualification board',()=>{
  assert.match(migration,/is_current_revision boolean not null default true/i);
  assert.match(migration,/partition by source_strategy_id/i);
  assert.match(migration,/source_strategy_revision_id <> p_source_strategy_revision_id[\s\S]*is_current_revision = true/i);
  assert.match(observation,/\.eq\('is_current_revision',true\)/);
  assert.match(lab,/current strategies/);
});

test('qualification observation excludes simulations and raw market reads',()=>{
  const observationBlock=migration.match(/-- Backtests are historical simulations[\s\S]*?update public\.marketplace_strategy_candidates/)?.[0]??'';
  assert.match(observationBlock,/decision_reports/);
  assert.match(observationBlock,/active_trades/);
  assert.doesNotMatch(observationBlock,/backtest_runs|market_scans/);
  assert.match(migration,/now\(\) - v_candidate\.observation_started_at/);
});

test('release metrics require a closed recorded trade and use current decision verdicts',()=>{
  assert.match(migration,/when v_trade_count > 0 then 'RECORDED_RESULTS_AVAILABLE'/);
  assert.match(migration,/result_r > 0\.05/);
  assert.match(migration,/greatest\(0, max\(equity_r\)/);
  assert.match(migration,/partition by result_class/);
  assert.match(migration,/verdict = 'AUTHORIZED'/);
  assert.match(migration,/verdict in \('REJECTED', 'WAIT'\)/);
  assert.match(migration,/count\(distinct source_strategy_id\)/);
});

test('the UI does not claim broker verification and metric refresh failures are not hidden',()=>{
  assert.match(lab,/Broker verification is not available yet/);
  assert.match(detail,/They are not broker-verified/);
  assert.doesNotMatch(`${lab}\n${detail}`,/VERIFIED LIVE RESULTS|VERIFIED TRADES|Recent verified trades/);
  assert.match(detailRoute,/metricsRefreshError[\s\S]*throw metricsRefreshError/);
});
