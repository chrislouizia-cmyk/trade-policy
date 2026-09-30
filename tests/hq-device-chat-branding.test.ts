import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('HQ has a distinct but canonical Trade Police identity',()=>{
  const layout=read('app/layout.tsx');
  const header=read('components/hq/HQHeader.tsx');
  const css=read('app/hq-brand.css');
  assert.match(header,/trade-police-logo\.png/);
  assert.match(header,/<strong>Headquarters<\/strong><small>Executive operations<\/small>/);
  assert.match(css,/body:has\(\.hq-container\)/);
  assert.match(css,/--hq-gold: #d8bf79/);
  assert.match(css,/--hq-mint: #70d5b5/);
  assert.ok(layout.indexOf("import './hq-brand.css';")>layout.indexOf("import './customer-brand.css';"));
});

test('tablet and phone layouts preserve touch targets and operational data access',()=>{
  const css=read('app/adaptive-experience.css');
  assert.match(css,/@media \(min-width: 761px\) and \(max-width: 1180px\)/);
  assert.match(css,/@media \(max-width: 760px\)/);
  assert.match(css,/@media \(max-width: 390px\)/);
  assert.match(css,/min-height: 44px/);
  assert.match(css,/\.directory-results-surface, \.sales-queue-directory/);
  assert.match(css,/overflow-x: auto/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
});

test('Strategy Copilot renders an accessible, readable mobile conversation',()=>{
  const builder=read('components/StrategyBuilderV2.tsx');
  const css=read('app/adaptive-experience.css');
  assert.match(builder,/strategy-v2-panel strategy-copilot-panel/);
  assert.match(builder,/role="log" aria-live="polite"/);
  assert.match(builder,/from-trade-police/);
  assert.match(builder,/from-trader/);
  assert.match(css,/\.copilot-message\.from-trade-police/);
  assert.match(css,/\.copilot-message\.from-trader/);
  assert.match(css,/max-height: min\(52dvh, 520px\)/);
  assert.match(css,/overflow-y: auto/);
});
