import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRATEGY_UUID,strategyOptionLabel} from '../lib/strategy-diagnostic-selector.ts';

const component=readFileSync(new URL('../components/hq/StrategyCompatibilityInspector.tsx',import.meta.url),'utf8');
const endpoint=readFileSync(new URL('../app/api/admin/diagnostics/strategies/route.ts',import.meta.url),'utf8');

test('selector labels distinguish owner, state, archive and instrument',()=>{
  const label=strategyOptionLabel({id:'1',name:'London Gold',ownerName:'Ada Owner',active:false,archived:true,instruments:['XAUUSD']});
  assert.equal(label,'London Gold — Ada Owner · Inactive · Archived · XAUUSD');
});

test('UUID fallback validates supported UUIDs',()=>{
  assert.equal(STRATEGY_UUID.test('550e8400-e29b-41d4-a716-446655440000'),true);
  assert.equal(STRATEGY_UUID.test('not-a-strategy-id'),false);
});

test('strategy discovery preserves owner and system.health authorization',()=>{
  assert.match(endpoint,/has_staff_permission.*p_permission:'system\.health'/s);
  assert.match(endpoint,/if\(!staffAllowed\)optionsQuery=optionsQuery\.eq\('user_id',user\.id\)/);
  assert.match(endpoint,/pageSize=20/);
  assert.match(endpoint,/ownerEmail:staffAllowed\?/);
  assert.match(endpoint,/createAdminClient/);
});

test('selector supports loading, empty, denied, failure and automatic single selection states',()=>{
  for(const copy of ['Loading strategies…','No accessible strategies found.','Strategies could not be loaded.','You do not have permission to load strategies.'])assert.match(component,new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(component,/items\.length===1&&Number\(body\.total\)===1/);
});

test('selection and advanced fallback call the existing diagnostic endpoint',()=>{
  assert.match(component,/diagnostics\/strategies\/\$\{encodeURIComponent\(strategyId\)\}/);
  assert.match(component,/if\(!STRATEGY_UUID\.test\(id\)\)/);
  assert.match(component,/initialStrategyId/);
  assert.match(component,/strategyId=\$\{encodeURIComponent\(strategyId\)\}/);
});
