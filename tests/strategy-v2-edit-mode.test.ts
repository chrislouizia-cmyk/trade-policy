import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const v2=readFileSync(new URL('../components/StrategyBuilderV2.tsx',import.meta.url),'utf8');

test('CREATE and EDIT are explicit V2 intents, not inferred from populated fields',()=>{
  assert.match(v2,/export type StrategyBuilderV2Mode='CREATE'\|'EDIT'/);
  assert.match(v2,/useState<CreationPath \| null>\(\(\)=>mode==='EDIT'\?'visual':null\)/);
  assert.match(v2,/mode==='CREATE'&&<div className="button-row" aria-label="Create strategy modes">/);
  assert.match(builder,/setV2EntryMode\('CREATE'\)/);
  assert.match(builder,/setV2EntryMode\('EDIT'\)/);
});

test('editing hydrates the exact persisted strategy and opens the shared editor directly',()=>{
  assert.match(builder,/function openV2Edit\(\)[\s\S]*persistedStrategyToV2State\(profile,rules,sessions\)[\s\S]*setV2Baseline\(hydrated\)[\s\S]*setV2Draft\(hydrated\)[\s\S]*setV2EntryMode\('EDIT'\)[\s\S]*setV2EntryOpen\(true\)/);
  assert.match(builder,/mode=\{v2EntryMode\}/);
  assert.match(builder,/key=\{`\$\{v2EntryMode\}:\$\{profile\.id\?\?'new'\}`\}/);
  assert.match(v2,/mode==='EDIT'\?'EDIT STRATEGY':'NEW STRATEGY'/);
  assert.match(v2,/Editing your existing strategy\. Changes update this saved strategy only\./);
});

test('edit apply keeps the selected profile identity and canonical save path',()=>{
  assert.match(v2,/v2StateToPersistedStrategy\(profile, currentState\(\)\)/);
  assert.match(builder,/function handleV2Apply\(persisted: V2Persisted\)[\s\S]*setProfile\(persisted\.profile\)[\s\S]*setRules\(persisted\.rules\)[\s\S]*setSessions\(persisted\.sessions\)/);
  assert.match(builder,/save\(v2StateToPersistedStrategy\(profile,draft\)\)/);
});

test('the existing semantic dirty guard still owns edit cancellation and discard',()=>{
  assert.match(builder,/isStrategyDirty\(v2Baseline,v2Draft\)/);
  assert.match(builder,/Save changes/);
  assert.match(builder,/Discard changes/);
  assert.match(builder,/setV2State\(v2Baseline\?\?undefined\)/);
});
