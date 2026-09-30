import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
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
  assert.match(account,/from\('active_trades'\)/);
  assert.doesNotMatch(account,/from\('trade_records'\).*taken_against_verdict/);
  assert.match(account,/isTradeLifecycleSimulationRecord/);
  assert.match(account,/buildObservedTraderProfile/);
  assert.match(account,/TraderProfileOverview/);
  assert.match(account,/account-overview-layout/);
  assert.match(account,/account-preference-layout/);
  assert.match(account,/account-language-panel/);
  assert.match(account,/account-destination-panel/);
  assert.match(account,/NEXT_PUBLIC_DISCORD_INVITE_URL/);
});

test('route changes retain the current workspace while prefetched navigation resolves',()=>{
  const navigation=read('components/AppPrimaryNavigation.tsx');
  const mobileNavigation=read('components/MobileBottomNav.tsx');
  const css=read('app/trade-police.css');
  assert.equal(existsSync(new URL('../app/loading.tsx',import.meta.url)),false);
  assert.match(navigation,/prefetch/);
  assert.match(mobileNavigation,/prefetch/);
  assert.doesNotMatch(css,/\.route-loading-shell/);
});

test('the first market chart measures and owns the actual remaining viewport',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  const css=read('app/trade-police.css');
  assert.match(panel,/market-first-viewport/);
  assert.match(panel,/getBoundingClientRect\(\)\.top/);
  assert.match(panel,/--market-workspace-height/);
  assert.match(css,/\.market-first-viewport \.market-chart-stage/);
  assert.match(css,/height:var\(--market-workspace-height/);
});
