import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
const v2=readFileSync(new URL('../components/StrategyBuilderV2.tsx',import.meta.url),'utf8');

test('CREATE and EDIT are explicit V2 intents, not inferred from populated fields',()=>{
  assert.match(v2,/export type StrategyBuilderV2Mode='CREATE'\|'EDIT'/);
  assert.match(v2,/useState<CreationPath>\(\(\)=>mode==='EDIT'\?'visual':'copilot'\)/);
  assert.match(v2,/mode==='CREATE'&&<div className="button-row" aria-label="Strategy creation entry paths">/);
  assert.match(v2,/STRATEGY_CREATION_ENTRY_PATHS\.map/);
  assert.match(builder,/setV2EntryMode\('CREATE'\)/);
  assert.match(builder,/setV2EntryMode\('EDIT'\)/);
});

test('editing hydrates the exact persisted strategy and opens the shared editor directly',()=>{
  assert.match(builder,/function openV2Edit\(targetProfile = profile, targetRules = rules, targetSessions = sessions\)[\s\S]*persistedStrategyToV2State\(targetProfile,targetRules,targetSessions\)[\s\S]*setV2Baseline\(hydrated\)[\s\S]*setV2Draft\(hydrated\)[\s\S]*setV2EntryMode\('EDIT'\)[\s\S]*setV2EntryOpen\(true\)/);
  assert.match(builder,/mode=\{v2EntryMode\}/);
  assert.match(builder,/key=\{`\$\{v2EntryMode\}:\$\{profile\.id\?\?'new'\}`\}/);
  assert.match(v2,/mode==='EDIT'\?'EDIT STRATEGY':'NEW STRATEGY'/);
  assert.match(v2,/Editing your existing strategy\. Changes update this saved strategy only\./);
});

test('edit apply keeps the selected profile identity and canonical save path',()=>{
  assert.match(v2,/persistedStrategyFromCurrentReview\(profile, draft, visualConfirmation\)/);
  assert.match(builder,/async function handleV2Apply\(persisted: V2Persisted\)[\s\S]*setProfile\(persisted\.profile\)[\s\S]*setRules\(persisted\.rules\)[\s\S]*setSessions\(persisted\.sessions\)/);
  assert.match(builder,/save\(persisted, 'CANONICAL'\)/);
});

test('the existing semantic dirty guard still owns edit cancellation and discard',()=>{
  assert.match(builder,/isStrategyDirty\(v2Baseline,v2Draft\)/);
  assert.match(builder,/Continue to review/);
  assert.match(builder,/Discard changes/);
  assert.match(builder,/setV2State\(v2Baseline\?\?undefined\)/);
});
