import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRATEGY_UUID,strategyOptionLabel} from '../lib/strategy-diagnostic-selector.ts';

const component=readFileSync(new URL('../components/hq/StrategyCompatibilityInspector.tsx',import.meta.url),'utf8');
const endpoint=readFileSync(new URL('../app/api/admin/diagnostics/strategies/route.ts',import.meta.url),'utf8');

test('selector labels distinguish owner, state, archive and instrument',()=>{
  const label=strategyOptionLabel({id:'1',name:'London Gold',customer:{id:'owner-1',name:'Ada Owner'},state:'ARCHIVED',instruments:['XAUUSD'],engineVersion:2});
  assert.equal(label,'London Gold — Ada Owner · ARCHIVED · XAUUSD · Engine v2');
});

test('UUID fallback validates supported UUIDs',()=>{
  assert.equal(STRATEGY_UUID.test('550e8400-e29b-41d4-a716-446655440000'),true);
  assert.equal(STRATEGY_UUID.test('not-a-strategy-id'),false);
});

test('strategy directory preserves authorization and returns the sanitized DTO boundary',()=>{
  assert.match(endpoint,/has_staff_permission.*p_permission:'system\.health'/s);
  assert.match(endpoint,/loadHQStrategyDirectory/);
  assert.match(endpoint,/ownerId:staffAllowed\?undefined:user\.id/);
  assert.match(endpoint,/createAdminClient/);
});

test('directory supports loading, empty, denied and failure states',()=>{
  for(const copy of ['Loading strategy directory…','No strategies match these filters.','The strategy directory could not be loaded. Please retry.','You do not have permission to inspect strategies.'])assert.match(component,new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('directory is searchable and UUID remains an advanced-only fallback',()=>{
  assert.match(component,/Search customer or strategy name/);
  assert.match(component,/Methodology \/ category/);
  assert.match(component,/Advanced · open by UUID/);
  assert.match(component,/if\(!STRATEGY_UUID\.test\(id\)\)/);
  assert.match(component,/initialStrategyId/);
  assert.match(component,/strategyId=\$\{encodeURIComponent\(item\.id\)\}/);
});
