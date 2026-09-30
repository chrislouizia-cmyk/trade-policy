import assert from 'node:assert/strict';
import test from 'node:test';
import {buildObservedTraderProfile} from '../lib/trader-profile-metrics.ts';

const trade=(overrides:Record<string,unknown>={})=>({source:'EXECUTED',status:'CLOSED',outcome:'WIN',risk_percent:.5,taken_against_verdict:false,created_at:'2026-01-01T10:00:00.000Z',closed_at:'2026-01-01T12:00:00.000Z',post_analysis:{executionQuality:'GOOD',ruleViolations:[]},...overrides});

test('observed profile remains explicitly insufficient before five closed executed trades',()=>{
  const profile=buildObservedTraderProfile([trade(),trade()],.5);
  assert.equal(profile.confidence,'INSUFFICIENT');
  assert.equal(profile.sampleSize,2);
});

test('observed profile derives transparent behavior metrics from closed executed trades',()=>{
  const profile=buildObservedTraderProfile([
    trade(),trade(),trade(),
    trade({outcome:'LOSS',taken_against_verdict:true,risk_percent:.75,post_analysis:{executionQuality:'MIXED',ruleViolations:['Early entry']}}),
    trade({outcome:'BREAKEVEN'}),
  ],.5);
  assert.equal(profile.confidence,'EARLY');
  assert.equal(profile.observedType,'Day trader');
  assert.deepEqual(profile.metrics.map(metric=>metric.value),[80,60,92,80,80]);
});

test('suggested and open rows never enter the observed sample',()=>{
  const profile=buildObservedTraderProfile([trade({source:'SUGGESTED'}),trade({status:'OPEN'})],.5);
  assert.equal(profile.sampleSize,0);
});
