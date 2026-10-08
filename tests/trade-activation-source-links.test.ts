import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const validator = readFileSync(new URL('../components/TradeValidator.tsx', import.meta.url), 'utf8');

test('trade activation keeps the decision source and saved report identifiers distinct', () => {
  assert.match(validator, /sourceDecisionId:result\.reportSourceId,sourceReportId:reportSave\.reportId \?\? undefined/);
  assert.doesNotMatch(validator, /sourceReportId:result\.reportSourceId/);
});

test('decision source remains available when no historical report has been saved', () => {
  assert.match(validator, /sourceDecisionId:result\.reportSourceId/);
  assert.match(validator, /sourceReportId:reportSave\.reportId \?\? undefined/);
});

test('existing override modal is reachable only through the explicit override-reason contract', () => {
  assert.match(validator, /authorizationEligibility\?\.reasonCode === 'OVERRIDE_REASON_REQUIRED'/);
  assert.match(validator, /\['WAIT','BLOCKED'\]\.includes\(authorizationEligibility\.state\)/);
  assert.match(validator, /setTradeActionMode\(activationUiState\.activationMode==='READY'\?'ACTIVATE':'OVERRIDE'\)/);
  assert.match(validator, /if\(isOverride && !overrideReason\)/);
  assert.match(validator, /if\(!tradeActionContext\.confirmed\)/);
});
