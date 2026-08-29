import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');
const css = fs.readFileSync('components/StrategyDetailPage.module.css', 'utf8');

test('View Report opens a dedicated modal instead of scrolling to page footer', () => {
  assert.match(detail, /setReportModalOpen\(true\)/);
  assert.doesNotMatch(detail, /scrollIntoView/);
  assert.match(detail, /role="dialog"/);
  assert.match(detail, /aria-label="Backtest report"/);
});

test('report modal preserves persisted report content', () => {
  assert.match(detail, /reportModalBackdrop/);
  assert.match(detail, /reportModalShell/);
  assert.match(detail, /reportModalCard/);
  assert.match(detail, /reportResult/);
  assert.match(detail, /reportTrades/);
  assert.match(detail, /opportunityFunnel/);
  assert.match(detail, /sampleQuality/);
});

test('report modal can close by button, backdrop, and Escape', () => {
  assert.match(detail, /setReportModalOpen\(false\)/);
  assert.match(detail, /handleReportEscape/);
  assert.match(detail, /event\.key === 'Escape'/);
  assert.match(detail, /event\.currentTarget === event\.target/);
});

test('report modal is a large scrollable card and locks background scrolling', () => {
  assert.match(detail, /document\.body\.style\.overflow = 'hidden'/);
  assert.match(css, /\.reportModalBackdrop/);
  assert.match(css, /\.reportModalShell/);
  assert.match(css, /height: min\(860px, 92vh\)/);
  assert.match(css, /overflow-y: auto !important/);
});
