import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const panel = fs.readFileSync('components/LiveMarketPanel.tsx','utf8');
const validator = fs.readFileSync('components/TradeValidator.tsx','utf8');

test('request identity includes strategy revision and instrument', () => {
  assert.match(panel, /strategyId:\s*strategy\.id/);
  assert.match(panel, /strategyRevisionId:\s*strategyRevisionId/);
  assert.match(panel, /instrument:\s*selectedInstrument/);
  assert.match(panel, /requestContextKey = `\$\{strategy\.id\}:\$\{strategyRevisionId\}:\$\{selectedInstrument\}`/);
});

test('late response cannot overwrite evidence after context changes', () => {
  assert.match(panel, /analysisContextRef\.current !== requestContextKey/);
  assert.match(panel, /appliedStrategyId !== strategy\.id/);
  assert.match(panel, /\.instrument !== selectedInstrument/);
});

test('current evidence identity ref follows strategy revision and instrument', () => {
  assert.match(panel, /analysisContextRef\.current = `\$\{strategy\.id \?\? ''\}:\$\{strategyRevisionId \?\? ''\}:\$\{selectedInstrument\}`/);
  assert.match(panel, /\[selectedInstrument,strategy\.id,strategyRevisionId\]/);
});

test('strategy switch already clears evidence-derived state', () => {
  for (const expected of [
    'setAnalysis(null)',
    'setResult(null)',
    'setAutoChecks({})',
    'setLastAnalysisInput(null)',
    'setFeedbackAnalysisId(null)',
    "setTypedMessage('')",
    'setSessionHistory([])',
  ]) assert.ok(validator.includes(expected), expected);
});

test('live panel remounts for strategy revision identity', () => {
  assert.match(validator, /key=\{`live-\$\{strategy\.id\}-\$\{activeStrategyRevisionId \?\? 'pending'\}`\}/);
});
