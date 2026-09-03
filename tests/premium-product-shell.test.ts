import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('authenticated workspace shares the premium landing visual system',()=>{
  const layout=read('app/layout.tsx');
  const css=read('app/product-premium.css');
  const dashboard=read('components/Dashboard.tsx');
  assert.match(layout,/product-premium\.css/);
  for(const selector of ['app-shell-header','command-center-hero','account-layout','decision-explanation-hero']) assert.match(css,new RegExp(selector));
  assert.match(dashboard,/DecisionStateGuide/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('decision states are explicit, contextual and multilingual',()=>{
  const guide=read('components/DecisionStateGuide.tsx');
  const hero=read('components/decision/DecisionHero.tsx');
  for(const state of ['READY','WAIT','BLOCKED']) assert.match(guide,new RegExp(state));
  assert.match(guide,/No es una predicción ni una garantía de ganancia/);
  assert.match(guide,/Ce n’est ni une prédiction ni une garantie de gain/);
  assert.match(hero,/What does this state mean/);
  assert.match(hero,/DecisionStateGuide/);
});

test('FAQ is visible and public trust pages use the shared premium shell',()=>{
  const landing=read('app/page.tsx');
  const about=read('app/about/page.tsx');
  const legal=read('app/legal/page.tsx');
  const faq=read('app/faq/page.tsx');
  assert.match(landing,/href="\/faq">FAQ/);
  for(const page of [about,legal,faq]) assert.match(page,/PublicSiteHeader/);
  assert.match(legal,/<details/);
  assert.match(faq,/DecisionStateGuide/);
});
