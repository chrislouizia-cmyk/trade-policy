import test from 'node:test';
import assert from 'node:assert/strict';
import {HQ_STRATEGY_EXCLUDED_FIELDS,toHQStrategySummary} from '../lib/hq/strategy-summary.ts';

const source={id:'strategy-1',user_id:'customer-1',name:'London pullback',is_default:true,is_archived:false,instruments:['GBPUSD','XAUUSD'],trading_style:'intraday',engine_version:2,macro_timeframe:'H1',trend_timeframe:'M15',confirmation_timeframe:'M5',entry_timeframe:'M5',trigger_timeframe:'M1',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-02T00:00:00Z'};
const rules=[{strategy_id:'strategy-1',enabled:true,mandatory:true,evaluation_mode:'AUTOMATIC'},{strategy_id:'strategy-1',enabled:true,mandatory:false,evaluation_mode:'MANUAL'},{strategy_id:'strategy-1',enabled:false,mandatory:true,evaluation_mode:'AUTOMATIC'}];

test('HQStrategySummary exposes accountability metadata and aggregate usage only',()=>{
  const summary=toHQStrategySummary(source,'Ada',rules,{analyses:8,decisions:5,tradesTaken:2,users:1,lastUsedAt:'2026-01-03T00:00:00Z'});
  assert.deepEqual(summary.rules,{total:2,required:1,optional:1,automatic:1,manual:1,external:0});
  assert.equal(summary.state,'ACTIVE');assert.equal(summary.usage.activityState,'ACTIVE');assert.equal(summary.health.state,'HEALTHY');
  assert.deepEqual(summary.instruments,['GBPUSD','XAUUSD']);assert.equal(summary.timeframeRoles.macro,'H1');
});
test('HQStrategySummary never serializes private strategy configuration',()=>{
  const json=JSON.stringify(toHQStrategySummary(source,'Ada',rules));
  for(const field of HQ_STRATEGY_EXCLUDED_FIELDS)assert.equal(json.includes(field),false,`${field} must not leave the HQ-safe DTO`);
  for(const privateValue of ['private threshold','secret note','ALL','order-block'])assert.equal(json.includes(privateValue),false);
});
test('HQStrategySummary marks missing core configuration without inventing settings',()=>{
  const summary=toHQStrategySummary({...source,instruments:[],name:' '},null,[]);
  assert.equal(summary.health.state,'NEEDS_CONFIGURATION');assert.equal(summary.usage.activityState,'NOT_YET_USED');assert.equal(summary.health.dataUnavailableRate,null);
});
