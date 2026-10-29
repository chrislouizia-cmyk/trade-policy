import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const validator = read('components/TradeValidator.tsx');
const hero = read('components/decision/DecisionHero.tsx');
const market = read('components/LiveMarketPanel.tsx');

test('Validate presents one progressive journey instead of a parallel tutorial and empty trade form', () => {
  assert.doesNotMatch(validator, /activation-walkthrough|EDUCATIONAL WALKTHROUGH|Start with the first analysis flow/);
  assert.doesNotMatch(validator, /validate-next-step/);
  assert.match(validator, /analysis&&<div className="validate-workspace-grid"/);
  assert.match(market, /STEP 1 · CHECK CURRENT MARKET/);
  assert.match(validator, /STEP 2 · REVIEW TRADE DETAILS/);
});

test('the canonical state owns the one visible next-step instruction in each phase', () => {
  assert.doesNotMatch(validator, /data-validate-status/);
  assert.match(validator, /validateExperience\.label/);
  assert.match(validator, /validateExperience\.guidance/);
  assert.match(validator, /experienceGuidance=\{validateExperience\.guidance\}/);
  assert.match(hero, /data-validate-status/);
  assert.match(hero, /decisionStatus/);
  assert.match(hero, /experienceGuidance/);
});

test('the temporary requested strategy remains explicit without repeating the active strategy card', () => {
  assert.match(validator, /strategySelectionMode === 'REQUESTED'&&<section className="card selected-validation-strategy"/);
  assert.match(validator, /SAVED STRATEGY SELECTED FOR THIS CHECK/);
  assert.match(validator, /without changing your active strategy/);
  assert.doesNotMatch(validator, /strategySelectionMode === 'REQUESTED' \? w\('SAVED STRATEGY SELECTED FOR THIS CHECK'\) : w\('ACTIVE STRATEGY'\)/);
});

test('existing market, risk, decision and lifecycle actions remain connected', () => {
  for (const value of ['Check current market', 'Run Final Risk Check', 'Take Trade', 'Take Anyway', 'Mark as missed']) {
    assert.match(`${market}\n${hero}\n${validator}`, new RegExp(value, 'i'));
  }
  assert.match(hero, /form="final-risk-check"/);
  assert.match(validator, /authorizationEligibility/);
  assert.match(validator, /saveTakenTrade/);
});
