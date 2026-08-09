import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const validator = read('components/TradeValidator.tsx');
const hero = read('components/decision/DecisionHero.tsx');
const playbook = read('components/PlaybookEvaluation.tsx');
const css = read('app/trade-police.css');

test('desktop uses a compact sticky decision panel beside the analysis workspace', () => {
  assert.match(css, /\.validate-workspace-grid\{grid-template-columns:minmax\(0,1fr\) minmax\(320px,390px\)/);
  assert.match(css, /\.decision-workspace-column \.decision-hero\{position:sticky;top:18px/);
  for (const label of ['Readiness', 'Confidence', 'Required', 'Violations']) assert.match(hero, new RegExp(label));
  assert.match(hero, /decision-panel-instrument/);
});

test('mobile places the decision panel before analysis and evidence without horizontal layout', () => {
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.decision-workspace-column \.decision-hero\{position:static;grid-column:1;grid-row:1/);
  assert.match(css, /\.trade-workspace\{grid-column:1;grid-row:2\}/);
  assert.match(css, /\.decision-workspace-column \.narrative-workspace\{grid-column:1;grid-row:3\}/);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*\.validate-workspace-grid>\*\{min-width:0\}/);
});

test('all decision actions remain connected to their existing flows', () => {
  for (const action of ['Take trade', 'Take anyway', 'Mark as missed', 'Save setup', 'View full Decision Report']) assert.match(`${validator}\n${hero}`, new RegExp(action, 'i'));
  assert.match(validator, /setTradeActionMode\('ACTIVATE'\)/);
  assert.match(validator, /setTradeActionMode\('OVERRIDE'\)/);
  assert.match(validator, /setTradeActionMode\('MISSED'\)/);
  assert.match(validator, /primaryActionDisabled=\{analyzing \|\| !analysis \|\| !activationUiState\.showCta/);
});

test('playbook evaluation separates existing rule modes and uses presentation-only statuses', () => {
  for (const label of ['Required checks', 'Optional confirmations', 'Manual confirmations', 'External checks']) assert.match(playbook, new RegExp(label));
  assert.match(playbook, /'PASS'.*'FAIL'.*'UNKNOWN'.*'PENDING'/s);
  assert.match(playbook, /buildMethodologyAudit/);
  assert.doesNotMatch(playbook, /fetch\(|createClient|decision-engine|market-analysis/);
});

test('technical evidence and historical report remain available but collapsed by default', () => {
  for (const label of ['Full rule evaluation', 'Playbook Trace and Methodology Applied', 'Historical Decision Report']) assert.match(validator, new RegExp(`<summary>${label}</summary>`));
  assert.doesNotMatch(validator, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(hero, /View full Decision Report/);
});

test('authorization result is adjacent to the final risk check', () => {
  assert.match(validator, /authorization-section[\s\S]{0,1000}authorization-inline-result/);
  assert.match(validator, /AUTHORIZATION RESULT/);
});
