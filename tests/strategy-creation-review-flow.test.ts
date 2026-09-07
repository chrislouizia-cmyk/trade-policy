import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const v2 = readFileSync(new URL('../components/StrategyBuilderV2.tsx', import.meta.url), 'utf8');
const parent = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');

test('canonical CREATE and EDIT share one authoritative review contract', () => {
  assert.match(v2, /canonicalDraftForVisibleV2Review/);
  assert.match(v2, /confirmCanonicalStrategyReview/);
  assert.match(v2, /persistedStrategyFromCurrentReview/);
  assert.match(v2, /operation === 'UPDATE'/);
  assert.match(v2, /activationIntent === 'ACTIVATE'/);
  assert.match(parent, /await save\(persisted, 'CANONICAL'\)/);
  assert.doesNotMatch(parent, /handleV2Apply[\s\S]{0,500}setBuilderStep\('review'\)/);
});

test('canonical save bypasses post-save confirmations but retains legacy education paths', () => {
  assert.match(parent, /experience==='CANONICAL'[\s\S]*setLearningConfirmation\(null\)[\s\S]*setVerification\(null\)/);
  assert.match(parent, /else setLearningConfirmation\(\{profile:savedProfile,rules:\[\.\.\.saveRules\]\}\)/);
  assert.match(parent, /if \(verification\) return <MethodologyVerification/);
  assert.match(parent, /if \(learningConfirmation\) return/);
  assert.match(parent, /if \(canonicalCompletion\) return/);
});

test('dirty navigation cannot bypass canonical review to save', () => {
  assert.match(parent, /Review and confirm the current strategy before saving/);
  assert.match(parent, /Continue to review/);
  assert.doesNotMatch(parent, /dirtyPrompt[\s\S]{0,1800}save\(v2StateToPersistedStrategy/);
});

test('duplicate stays explicit and clears persisted identity', () => {
  assert.match(parent, /async function duplicate[\s\S]*id: undefined[\s\S]*Copy/);
  assert.match(parent, /requestedMode === 'duplicate'/);
});
