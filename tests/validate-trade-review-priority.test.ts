import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Step 2 prioritizes the actionable trade ticket before supporting evidence', () => {
  const validator = read('components/TradeValidator.tsx');
  const formIndex = validator.indexOf('<form id="final-risk-check"');
  const evidenceIndex = validator.indexOf('<details className="validate-supporting-evidence"');

  assert.ok(formIndex >= 0, 'the canonical final-risk form must remain available');
  assert.ok(evidenceIndex > formIndex, 'supporting evidence must follow the actionable ticket');
  assert.match(validator, /<summary>What Trade Police checked<\/summary>/);
  assert.doesNotMatch(validator, /validate-supporting-evidence" open/);
});

test('all evidence remains available inside progressive disclosure', () => {
  const validator = read('components/TradeValidator.tsx');
  assert.match(validator, /validate-supporting-evidence[\s\S]*<MarketContextStrip analysis=\{analysis\}\/>[\s\S]*<PlaybookEvaluation/);
  assert.match(validator, /ADVANCED EVIDENCE/);
  assert.match(validator, /Full rule evaluation/);
});

test('every value that affects validation stays visibly reviewable in Step 2', () => {
  const validator = read('components/TradeValidator.tsx');
  const hero = read('components/decision/DecisionHero.tsx');
  for (const field of ['instrument', 'direction', 'entry', 'stopLoss', 'takeProfit', 'accountBalance', 'riskPercent', 'tradesToday', 'session', 'highImpactNews']) {
    assert.match(validator, new RegExp(`name="${field}"`), field);
  }
  assert.match(validator, /Manual confirmations/);
  assert.match(validator, /Complete manual confirmations/);
  assert.match(hero, /form="final-risk-check"/);
});

test('supporting evidence components remain read-only presentation adapters', () => {
  const marketContext = read('components/MarketContextStrip.tsx');
  const playbook = read('components/PlaybookEvaluation.tsx');
  assert.doesNotMatch(`${marketContext}\n${playbook}`, /fetch\(|createClient|\/api\//);
  assert.match(playbook, /buildMethodologyAudit/);
  assert.match(marketContext, /orderedTimeframes/);
});
