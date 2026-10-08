import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const validator=readFileSync(new URL('../components/TradeValidator.tsx',import.meta.url),'utf8');

test('override submission sends the required reason to the active-trade endpoint',()=>{
  assert.match(validator,/const overrideReason = tradeActionContext\.reason\?\.trim\(\) \|\| null/);
  assert.match(validator,/fetch\('\/api\/trades\/take',[\s\S]*overrideReason/);
  assert.match(validator,/if\(isOverride && !overrideReason\)/);
});

test('a successful override closes the modal, refreshes the trade state, and opens Active Trade',()=>{
  assert.match(validator,/await loadHistory\(\);\s*setActivationSuccess\([\s\S]*closeTradeActionModal\(\);[\s\S]*window\.location\.assign\('\/active-trade'\)/);
});

test('a failed override keeps the modal open and exposes an actionable error in it',()=>{
  assert.match(validator,/if\(!response\.ok\)[\s\S]*throw new Error\(message\)/);
  assert.match(validator,/catch\(e:unknown\)\{setTradeActionFailure/);
  assert.match(validator,/tradeActionError\?<p className="take-anyway-submit-error" role="alert">/);
  assert.doesNotMatch(validator,/catch\(e:unknown\)\{[\s\S]{0,120}closeTradeActionModal\(\)/);
});

test('double-clicking an override cannot create a duplicate active trade',()=>{
  assert.match(validator,/if\(tradeSubmissionRef\.current\)return/);
  assert.match(validator,/tradeSubmissionRef\.current=true;\s*setSavingTrade\(true\)/);
  assert.match(validator,/finally\{tradeSubmissionRef\.current=false;setSavingTrade\(false\);\}/);
  assert.match(validator,/disabled=\{savingTrade \|\| !tradeActionContext\.confirmed \|\| !tradeActionContext\.reason\?\.trim\(\)\}/);
  assert.match(validator,/savingTrade\?'Taking trade…':'Confirm take anyway'/);
});
