import assert from 'node:assert/strict';import test from 'node:test';import{readFileSync}from'node:fs';

test('Strategy detail renders the canonical single-card experience for saved strategies',()=>{
  const detail=readFileSync(new URL('../components/StrategyDetailPage.tsx',import.meta.url),'utf8');
  for(const text of ['STRATEGY DETAIL','Overview','Rules','Backtests','Forward Test','Unlimited backtests'])assert.match(detail,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const builder=readFileSync(new URL('../components/StrategyBuilder.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(builder,/selectedProfile&&<StrategyInspector/);
  assert.match(builder,/if\s*\(\s*selectedProfile\s*\)\s*\{\s*return\s*\(\s*<div\s+className="strategy-builder-layout">/);
  assert.match(builder,/<StrategyDetailPage[\s\S]*planCode=\{planCode\}/);
});
