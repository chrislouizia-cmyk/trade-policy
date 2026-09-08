import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const page=read('app/validate/page.tsx');
const validator=read('components/TradeValidator.tsx');
const market=read('app/api/market/analyze/route.ts');
const validate=read('app/api/validate/route.ts');

test('server-selected strategy and canonical revision hydrate together without an active-strategy overwrite',()=>{
  assert.match(page,/initialStrategyRevisionId=\{strategyRevisionId\(strategy\)\}/);
  assert.match(validator,/initialStrategyRevisionId:string/);
  assert.match(validator,/useState<string\|null>\(initialStrategyRevisionId\)/);
  assert.doesNotMatch(validator,/useEffect\(\(\)=>\{ void loadStrategy\(\); void loadAccounts\(\); \},\[userId\]\)/);
  assert.match(validator,/useEffect\(\(\)=>\{ void loadAccounts\(\); \},\[userId\]\)/);
});

test('market check loads the requested owned strategy and rejects a stale revision',()=>{
  assert.match(market,/loadStrategyById\(supabase,user\.id,body\.strategyId\)/);
  assert.match(market,/STRATEGY_REVISION_CHANGED/);
  assert.match(market,/body\.strategyRevisionId!==currentStrategyRevisionId/);
});

test('final validation derives strategy identity from the server-created scan',()=>{
  assert.match(validate,/loadStrategyById\(supabase,user\.id,scan\.strategy_profile_id\)/);
  assert.doesNotMatch(validate,/const strategy = await loadActiveStrategy/);
  assert.match(validate,/scan\.strategy_revision_id!==strategyRevisionId\(strategy\)/);
});

test('one primary action hierarchy remains and history navigation is truthfully labelled',()=>{
  const advancedEvidence=validator.slice(validator.indexOf('ADVANCED EVIDENCE'),validator.indexOf('{feedbackAnalysisId'));
  assert.doesNotMatch(advancedEvidence,/setTradeActionMode/);
  assert.match(validator,/onViewHistory=\{\(\)=>\{window\.location\.href='\/history'\}\}/);
  const hero=read('components/decision/DecisionHero.tsx');
  assert.match(hero,/View History/);
  assert.doesNotMatch(hero,/>Save Setup</);
});
