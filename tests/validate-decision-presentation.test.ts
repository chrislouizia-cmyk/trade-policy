import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const validator = read('components/TradeValidator.tsx');
const hero = read('components/decision/DecisionHero.tsx');

test('the decision hero is the one authoritative visible answer', () => {
  assert.equal((validator.match(/<DecisionHero/g) ?? []).length, 1);
  assert.match(hero, /decision-hero-verdict/);
  assert.doesNotMatch(validator, /<p className="brand">YOUR ANSWER<\/p>/);
  assert.match(validator, /<details className="card primary-workspace-surface decision-report-workspace narrative-workspace validate-decision-details">/);
  assert.doesNotMatch(validator, /validate-decision-details" open/);
});

test('explanation and records remain available behind one secondary disclosure', () => {
  assert.match(validator, /<summary className="validate-decision-details-summary"><span>Decision details and records<\/span><small>Explanation, coaching, and advanced evidence<\/small><\/summary>/);
  for (const label of ['Why this decision?', "What's missing?", 'What should I do next?', 'ADVANCED EVIDENCE']) {
    assert.match(validator, new RegExp(label.replace(/[?]/g, '\\?')));
  }
  for (const label of ['Decision Record', 'Historical Decision Report', 'Full rule evaluation', 'Playbook Trace and Methodology Applied']) {
    assert.match(validator, new RegExp(label));
  }
});

test('canonical trade actions and confirmation safeguards remain unchanged', () => {
  for (const action of ['Take Trade', 'Take Anyway', 'Mark as missed', 'Run Final Risk Check']) {
    assert.match(`${validator}\n${hero}`, new RegExp(action, 'i'));
  }
  assert.match(validator, /saveTakenTrade\('ACTIVATE'\)/);
  assert.match(validator, /saveTakenTrade\('OVERRIDE'\)/);
  assert.match(validator, /markTradeMissed\(\)/);
  assert.match(validator, /tradeActionContext\.confirmed/);
  assert.match(validator, /tradeActionContext\.reason\?\.trim\(\)/);
});
