import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('landing hero CTAs share stable geometry across responsive layouts',()=>{
  const landing=read('app/page.tsx');
  const styles=read('app/trade-police-landing.module.css');
  assert.match(landing,/styles\.primaryCta/);
  assert.match(landing,/styles\.secondaryCta/);
  assert.match(styles,/\.primaryCta[^}]*min-height:48px/);
  assert.match(styles,/@media\(max-width:680px\)/);
  assert.match(styles,/\.actions\{align-items:stretch;flex-direction:column\}/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
});
