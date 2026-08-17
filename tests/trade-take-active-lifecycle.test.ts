import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route=readFileSync(new URL('../app/api/trades/take/route.ts',import.meta.url),'utf8');
const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');

test('override activation returns a persisted trade together with explicit ACTIVE lifecycle confirmation',()=>{
  assert.match(route,/active_trades'\)\.insert/);
  assert.match(route,/select\(\)\.single\(\)/);
  assert.match(route,/lifecycleStatus:decisionCheck\.status/);
  assert.match(route,/activeTradeCreated:decisionCheck\.createActiveTrade===true/);
});

test('client closes and navigates only after the API confirms that an ACTIVE trade exists',()=>{
  assert.match(validator,/activation\.lifecycleStatus!=='ACTIVE'/);
  assert.match(validator,/activation\.activeTradeCreated!==true/);
  assert.match(validator,/typeof activation\.trade\?\.id!=='string'/);
  assert.match(validator,/closeTradeActionModal\(\);\s*if\(isOverride\)[\s\S]*window\.location\.assign\('\/active-trade'\)/);
});

test('duplicate protection remains enforced in both client and server paths',()=>{
  assert.match(validator,/if\(tradeSubmissionRef\.current\)return/);
  assert.match(route,/You already have an open trade for this instrument/);
  assert.match(route,/code==='23505'/);
});
