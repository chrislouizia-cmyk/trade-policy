import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('decision keeps the simple verdict and exposes deterministic rule progress',()=>{
  const hero=read('components/decision/DecisionHero.tsx');
  assert.match(hero,/decision-rule-progress/);
  assert.match(hero,/confirmedRequiredCount/);
  assert.match(hero,/incompleteRequired/);
  assert.match(hero,/Required · needs attention/);
  assert.match(hero,/experienceLevel==='Advanced'/);
});

test('chart fullscreen owns the dynamic viewport without vertical overflow',()=>{
  const css=read('app/trade-police.css');
  assert.match(css,/market-position-chart-shell:fullscreen/);
  assert.match(css,/height:100dvh/);
  assert.match(css,/grid-template-rows:auto auto minmax\(0,1fr\)/);
});

test('account settings use existing identity fields and evidence-backed observed metrics',()=>{
  const account=read('app/account/page.tsx');
  assert.match(account,/experience_level,trader_type/);
  assert.match(account,/buildObservedTraderProfile/);
  assert.match(account,/TraderProfileOverview/);
  assert.match(account,/account-language-row/);
});
