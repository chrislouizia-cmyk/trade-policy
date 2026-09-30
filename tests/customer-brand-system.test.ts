import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('the customer brand layer is imported last and remains scoped away from HQ',()=>{
  const layout=read('app/layout.tsx');
  const css=read('app/customer-brand.css');
  assert.ok(layout.indexOf("import './customer-brand.css';")>layout.indexOf("import './liquid-glass.css';"));
  assert.match(css,/body:has\(\.mobile-bottom-nav\)/);
  assert.doesNotMatch(css,/\.hq-/);
});

test('the brand system preserves the real wordmark and evidence-first philosophy',()=>{
  const header=read('components/AppHeader.tsx');
  const css=read('app/customer-brand.css');
  assert.match(header,/trade-police-logo\.png/);
  assert.match(header,/No trade without evidence\./);
  assert.match(css,/canonical-shell-brand \.brand-caption/);
  assert.match(css,/--tp-mint: #77dfbf/);
  assert.match(css,/--tp-gold: #dcc27b/);
  assert.match(css,/--tp-danger: #ff8c94/);
});

test('liquid glass remains readable, responsive and accessibility aware',()=>{
  const css=read('app/customer-brand.css');
  assert.match(css,/backdrop-filter: blur\(34px\) saturate\(145%\)/);
  assert.match(css,/@media \(max-width: 760px\)/);
  assert.match(css,/@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css,/canonical-visible-nav > a\.active::after/);
  assert.match(css,/:is\(input, select, textarea\):focus/);
});
