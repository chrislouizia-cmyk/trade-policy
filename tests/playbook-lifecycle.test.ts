import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const route=readFileSync(new URL('../app/api/strategies/delete/route.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/030_playbook_lifecycle.sql',import.meta.url),'utf8');

test('playbook lifecycle exposes edit duplicate archive restore and delete',()=>{
  for(const action of ['Edit','Duplicate','Archive','Restore','Delete'])assert.match(builder,new RegExp(`>${action}<`));
  assert.match(builder,/isArchived/);
  assert.match(builder,/ARCHIVED/);
});

test('permanent deletion requires an explicit confirmation dialog',()=>{
  assert.match(builder,/role="dialog"/);
  assert.match(builder,/aria-modal="true"/);
  assert.match(builder,/deleteConfirmation!==['"]DELETE['"]/);
  assert.match(route,/z\.literal\(['"]DELETE['"]\)/);
});

test('delete detaches historical references and never deletes analysis records',()=>{
  for(const table of ['trade_records','active_trades','market_scans'])assert.match(migration,new RegExp(`update public\\.${table}`));
  assert.match(migration,/set strategy_profile_id = null/g);
  assert.doesNotMatch(migration,/delete from public\.(trade_records|active_trades|market_scans)/);
  assert.match(migration,/delete from public\.strategy_profiles/);
});

test('active playbooks cannot be archived or deleted',()=>{
  assert.match(builder,/disabled=\{selectedProfile\.isDefault\}/);
  assert.match(migration,/if v_strategy\.is_default then raise exception/);
});
