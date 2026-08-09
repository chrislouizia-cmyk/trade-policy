import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const validator = read('components/TradeValidator.tsx');
const hero = read('components/decision/DecisionHero.tsx');
const playbook = read('components/PlaybookEvaluation.tsx');
const marketContext = read('components/MarketContextStrip.tsx');
const css = read('app/trade-police.css');

test('desktop uses a compact full-width horizontal decision header', () => {
  assert.match(css, /Validate decision terminal/);
  assert.match(css, /\.validate-workspace-grid[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.decision-explanation-hero\{display:grid;grid-template-columns:/);
  assert.doesNotMatch(css, /\.decision-workspace-column \.decision-hero\{position:sticky/);
  for (const label of ['Readiness', 'Confidence', 'Required', 'Pending', 'Violations']) assert.match(hero, new RegExp(label));
  assert.match(hero, /decision-panel-instrument/);
});

test('tablet and mobile use explicit compact, non-clipping breakpoints', () => {
  assert.match(css, /@media\(max-width:1023px\)/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /@media\(max-width:420px\)/);
  assert.match(css, /\.trade-workspace\{grid-template-columns:minmax\(0,1fr\);padding:14px\}/);
  assert.match(css, /\.live-panel \.tv-wrap\{height:280px\}/);
});

test('market context is a compact, honest five-timeframe strip', () => {
  for (const timeframe of ['D1', 'H4', 'H1', 'M30', 'M5']) assert.match(marketContext, new RegExp(`'${timeframe}'`));
  assert.match(marketContext, /Unavailable/);
  assert.match(css, /\.market-context-timeframes\{display:grid;grid-template-columns:repeat\(5/);
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
  assert.match(playbook, /open=\{key === 'required'\}/);
  assert.doesNotMatch(playbook, /fetch\(|createClient|decision-engine|market-analysis/);
});

test('technical evidence and historical report remain available but collapsed by default', () => {
  for (const label of ['Decision Record', 'Full rule evaluation', 'Playbook Trace and Methodology Applied', 'Historical Decision Report']) assert.match(validator, new RegExp(`<summary>${label}</summary>`));
  assert.match(validator, /ADVANCED EVIDENCE/);
  assert.match(hero, /View full Decision Report/);
});

test('authorization result is adjacent to the final risk check', () => {
  assert.match(validator, /authorization-section[\s\S]{0,1000}authorization-inline-result/);
  assert.match(validator, /AUTHORIZATION RESULT/);
});
