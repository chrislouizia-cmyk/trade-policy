import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('navigation preserves the current route while component loading remains accessible',()=>{
  const strategyBuilder=read('components/StrategyBuilder.tsx');
  assert.equal(fs.existsSync('app/loading.tsx'),false);
  assert.match(strategyBuilder,/strategy-builder-skeleton/);
  assert.match(strategyBuilder,/aria-busy="true"/);
  assert.doesNotMatch(strategyBuilder,/spinner/i);
});
test('strategy save and market analysis provide truthful progress feedback',()=>{
  const confirmation=read('components/StrategyLearningConfirmation.tsx');
  const market=read('components/LiveMarketPanel.tsx');
  assert.match(confirmation,/strategy-save-success/);
  assert.match(confirmation,/PLAYBOOK SAVED/);
  assert.match(confirmation,/aria-live="polite"/);
  assert.match(market,/analysis-progress-stages/);
  assert.match(market,/scanStages\.map/);
  assert.match(market,/aria-busy="true"/);
});

test('keyboard navigation is discoverable and avoids typing fields',()=>{
  const shortcuts=read('components/KeyboardShortcuts.tsx');
  const header=read('components/AppHeader.tsx');
  assert.match(header,/KeyboardShortcuts/);
  assert.match(header,/<Link href="\/dashboard"/);
  assert.match(shortcuts,/input, textarea, select, \[contenteditable="true"\]/);
  for(const route of ['/dashboard','/validate','/history','/profile','/analytics'])assert.match(shortcuts,new RegExp(route));
  assert.doesNotMatch(shortcuts,/framer-motion|gsap|lottie/i);
});

test('premium motion is lightweight, mobile-ready, and reduced-motion safe',()=>{
  const styles=read('app/trade-police.css');
  const polish=styles.slice(styles.indexOf('/* Premium interaction polish'));
  assert.match(polish,/premium-page-enter \.22s/);
  assert.match(polish,/@media\(max-width:760px\)/);
  assert.match(polish,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(polish,/animation:none!important/);
  assert.match(polish,/transition:none!important/);
  assert.doesNotMatch(polish,/animation:[^;}]*infinite/);
  assert.doesNotMatch(polish,/(?:animation|transition):[^;}]*(?:\.[3-9]\d*s|[3-9]\d{2,}ms)/);
});
