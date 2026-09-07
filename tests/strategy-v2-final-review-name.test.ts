import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('canonical V2 save bypasses the retained legacy Final Review bridge', () => {
  const source = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
  assert.match(source, /handleV2Apply[\s\S]*await save\(persisted, 'CANONICAL'\)/);
  assert.doesNotMatch(source, /handleV2Apply[\s\S]{0,500}setBuilderStep\('review'\)/);
  assert.match(source, /step-review[\s\S]*Strategy name<input value=\{profile\.name\}/);
  assert.match(source, /disabled=\{saving\|\|Boolean\(finalReviewNameError\)\|\|!finalReview\.canSave\}/);
});
