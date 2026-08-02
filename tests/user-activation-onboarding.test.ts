import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('activation experience surfaces onboarding guidance and starter shortcuts', () => {
  const checklist = read('components/OnboardingChecklist.tsx');
  const builder = read('components/StrategyBuilder.tsx');
  const validator = read('components/TradeValidator.tsx');

  assert.match(checklist, /ACTIVATION CHECKLIST/i);
  assert.match(checklist, /Use starter rules/);
  assert.match(builder, /quickstart/i);
  assert.match(validator, /EDUCATIONAL WALKTHROUGH/i);
});
