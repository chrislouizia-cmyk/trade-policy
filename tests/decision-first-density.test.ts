import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Validate alone uses the decision-focused compact application header', () => {
  const header = read('components/AppHeader.tsx');
  const validate = read('app/validate/page.tsx');
  const dashboard = read('app/dashboard/page.tsx');
  assert.match(header, /decisionFocused \? 'decision-focused-header' : ''/);
  assert.match(validate, /<AppHeader[^>]*decisionFocused/);
  assert.doesNotMatch(dashboard, /decisionFocused/);
});

test('decision-focused density removes repeated vertical copy but preserves navigation and context selectors', () => {
  const css = read('app/trade-police.css');
  assert.match(css, /\.decision-focused-header \.client-greeting-row\{display:none!important\}/);
  assert.match(css, /\.decision-focused-header \.primary-nav a\{padding:7px 10px!important;font-size:12px!important\}/);
  assert.match(css, /\.decision-focused-header \.context-copy\{display:none!important\}/);
  assert.match(css, /\.decision-focused-header \.context-switchers\{width:min\(100%,720px\)!important/);
});

test('strategy activity sits immediately after the market workspace and stays compact', () => {
  const validator = read('components/TradeValidator.tsx');
  const css = read('app/trade-police.css');
  const chartIndex = validator.indexOf('<LiveMarketPanel');
  const activityIndex = validator.indexOf('<section className="strategy-trade-activity"');
  const reviewIndex = validator.indexOf('{analysis&&<div className="validate-workspace-grid"');
  assert.ok(chartIndex >= 0 && activityIndex > chartIndex && reviewIndex > activityIndex);
  assert.match(css, /\.strategy-trade-activity\{display:grid;gap:9px;padding:12px 14px/);
  assert.match(css, /\.strategy-trade-activity \.trade-history-rows\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
