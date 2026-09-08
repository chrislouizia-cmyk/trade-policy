import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const v2 = readFileSync(new URL('../components/StrategyBuilderV2.tsx', import.meta.url), 'utf8');
const parent = readFileSync(new URL('../components/StrategyBuilder.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/trade-police.css', import.meta.url), 'utf8');

test('first-time canonical creation starts with plain-language intent instead of implementation terminology', () => {
  assert.match(v2, /mode==='EDIT'\?'visual':'copilot'/);
  assert.match(v2, /How do you trade\?/);
  assert.match(v2, /Your trading approach/);
  assert.match(v2, /Help me structure it/);
  assert.doesNotMatch(v2, /AI Strategy Copilot — Beta|deterministic engine|Generate structured draft|Apply \/ Update Draft|Draft summary/);
});

test('canonical clarification is action-only and remains visible even when no rule was understood', () => {
  assert.match(v2, /copilotReviewVisible && \(/);
  assert.match(v2, /copilotAssessment\.clarifications\.length > 0/);
  assert.match(v2, /A few details are still needed/);
  assert.match(v2, /No trading conditions understood yet/);
  assert.doesNotMatch(v2, /assessment\.clarifications\.map\(\(item\) => item\.question\)\.join/);
});

test('canonical describe path exposes exactly one final confirmation with human review language', () => {
  assert.equal((v2.match(/This matches how I trade, including the risk and whether it will be active\./g) ?? []).length, 1);
  assert.match(v2, /Review what Trade Police understood/);
  assert.match(v2, /Required' : 'Optional/);
  assert.match(v2, /All required conditions must be met/);
  assert.match(v2, /One of these alternatives may be enough/);
  assert.match(v2, /Risk per trade/);
  assert.match(v2, /Minimum RR/);
  assert.match(v2, /Save and activate/);
});

test('canonical save reports the outcome and offers a clear optional next action', () => {
  assert.match(parent, /STRATEGY SAVED AND ACTIVE/);
  assert.match(parent, /Trade Police will now use this strategy for new decisions/);
  assert.match(parent, /It will not replace your active strategy/);
  assert.match(parent, /href=\{`\/validate\?strategy=\$\{encodeURIComponent\(canonicalCompletion\.id\)\}`\}/);
  assert.match(parent, /Check a setup/);
  assert.match(parent, /View my strategies/);
});

test('edit and duplicate communicate distinct identity behavior', () => {
  assert.match(v2, /Editing your existing strategy\. Changes update this saved strategy only/);
  assert.match(v2, /mode === 'EDIT' && profile\.id/);
  assert.match(parent, /async function duplicate[\s\S]*id: undefined[\s\S]*setBuilderStep\('identity'\)/);
  assert.match(parent, /Rename the copy, review it, then save it as a separate strategy/);
});

test('advanced capability remains reachable and mobile review actions collapse without horizontal overflow', () => {
  assert.match(v2, /STRATEGY_CREATION_ENTRY_PATHS\.map/);
  assert.match(v2, /ADVANCED_STRATEGY_CREATION_MODES\.map/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.strategy-builder-v2 \.grid-2\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.strategy-builder-v2 \.button-row\{display:grid;grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /\.draft-review-panel\{overflow-wrap:anywhere\}/);
});

test('canonical readiness, exact reviewed persistence and silent-default protections remain in force', () => {
  assert.match(v2, /assessCanonicalCreationDraft\(canonicalCopilotDraft\)/);
  assert.match(v2, /confirmCanonicalStrategyReview/);
  assert.match(v2, /persistedStrategyFromCurrentReview\(profile, canonicalCopilotDraft, copilotConfirmation\)/);
  assert.match(v2, /!copilotReviewCurrent/);
  assert.doesNotMatch(v2, /XAUUSD.*(?:fallback|default)|(?:fallback|default).*XAUUSD/i);
});
