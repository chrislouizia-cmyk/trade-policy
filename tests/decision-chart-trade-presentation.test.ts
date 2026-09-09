import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');

test('an active trade remains visible over either chart implementation',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  assert.match(panel,/activeTradeOverlay=positionOverlay\?\.status==='ACTIVE'/);
  assert.match(panel,/market-chart-stage/);
  assert.match(panel,/market-active-trade-overlay/);
  for(const field of ['Entry','Stop','Target','Planned RR','View active trade'])assert.match(panel,new RegExp(field));
  assert.match(panel,/href="\/active-trade"/);
  assert.match(panel,/TradingViewChart[\s\S]*TradingViewReferenceChart[\s\S]*activeTradeOverlay/);
});

test('the chart-owned active trade overlay is compact, responsive and does not alter geometry',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  const css=read('app/trade-police.css');
  assert.match(css,/\.market-chart-stage\{position:relative/);
  assert.match(css,/\.market-active-trade-overlay\{position:absolute/);
  assert.match(css,/backdrop-filter:blur\(12px\)/);
  assert.match(css,/@media\(max-width:767px\)\{[\s\S]*?\.market-active-trade-overlay\{/);
  assert.match(css,/@media\(max-width:480px\)\{\.market-active-trade-overlay\{/);
  assert.doesNotMatch(panel,/setPositionOverlay|updateProposedGeometry|activatePositionOverlay/);
});

test('market analysis cannot replace a visible reference chart with an unpainted canvas',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  const chart=read('components/MarketPositionChart.tsx');
  const css=read('app/trade-police.css');
  assert.match(panel,/market-chart-reference-layer \$\{analyzedChartReady\?'is-hidden':''\}/);
  assert.match(panel,/market-chart-analysis-layer \$\{analyzedChartReady\?'is-ready':''\}/);
  assert.match(panel,/onDataReady=\{\(\)=>setPaintedChartKey\(chartDataKey\)\}/);
  assert.match(chart,/series\.setData\([\s\S]*requestAnimationFrame\(\(\)=>dataReadyRef\.current\?\.\(\)\)/);
  assert.match(css,/\.market-chart-stage\{position:relative;isolation:isolate;min-width:0;height:clamp\(320px,39vw,430px\)/);
  assert.match(css,/\.market-chart-analysis-layer\{z-index:2;opacity:0;pointer-events:none\}\.market-chart-analysis-layer\.is-ready\{opacity:1;pointer-events:auto\}/);
  assert.match(css,/\.market-position-chart-viewport\{position:relative;height:100%;min-height:0;overflow:hidden/);
  assert.match(css,/\.market-chart-layer \.market-position-chart-shell \.market-position-chart\{position:relative;inset:auto;height:100%;min-height:0\}/);
  assert.match(css,/\.market-position-zone\.reward\{[^}]*background:rgba\(32,180,134,\.11\)/);
  assert.match(css,/\.market-position-zone\.risk\{[^}]*background:rgba\(239,91,91,\.12\)/);
});

test('the authoritative decision remains directly below the chart in a compact hierarchy',()=>{
  const panel=read('components/LiveMarketPanel.tsx');
  const css=read('app/trade-police.css');
  assert.ok(panel.indexOf("analysisSource==='LIVE' ? decisionContent : null")>panel.indexOf('market-chart-stage'));
  assert.match(css,/\.live-panel>\.decision-explanation-hero\{grid-template-columns:minmax\(0,1fr\) 210px;gap:8px 14px;margin-top:10px;padding:13px 15px/);
  assert.match(css,/\.live-panel>\.decision-explanation-hero \.required-rule-count\{display:none\}/);
  assert.match(css,/\.live-panel>\.decision-explanation-hero \.decision-panel-metrics>div\{padding:6px 8px\}/);
});
