import assert from 'node:assert/strict';
import test from 'node:test';
import { isStopDistanceWithinMaximum, meetsMinimumRiskReward, normalizedRiskReward } from '../lib/trade-risk.ts';

test('minimum RR comparison is inclusive at the configured boundary',()=>{
  for(const [actualRR,passes] of [[3,true],[3.01,true],[2.99,false]] as const){
    const normalized=normalizedRiskReward(100,99,100+actualRR);
    assert.equal(meetsMinimumRiskReward(normalized,3),passes,`actual ${actualRR}`);
  }
});

test('maximum stop comparison is inclusive at the configured boundary',()=>{
  assert.equal(isStopDistanceWithinMaximum(2.99,3),true);
  assert.equal(isStopDistanceWithinMaximum(3,3),true);
  assert.equal(isStopDistanceWithinMaximum(3.01,3),false);
});
