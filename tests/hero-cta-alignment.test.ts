import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('landing hero CTAs share stable geometry across responsive layouts',()=>{
  const landing=read('app/page.tsx');
  const styles=read('app/trade-police.css');
  assert.equal((landing.match(/hero-cta/g)??[]).length,2);
  assert.match(styles,/\.marketing-hero \.hero-cta\{[^}]*height:48px;[^}]*min-height:48px;[^}]*padding:0 18px;[^}]*font-size:14px;[^}]*font-weight:700;[^}]*line-height:1;[^}]*white-space:nowrap/);
  assert.match(styles,/\.marketing-hero \.hero-cta:focus-visible\{[^}]*box-shadow:0 0 0 3px/);
  assert.match(styles,/@media\(max-width:768px\)\{\.marketing-hero \.hero-actions\{align-items:stretch\}\.marketing-hero \.hero-cta\{width:100%;align-self:stretch\}\}/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)\{\.marketing-hero \.hero-cta\{transition:none!important\}\}/);
});
