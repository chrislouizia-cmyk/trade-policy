import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('strategy detail and builder use the canonical profile workflow for back, edit, and duplicate actions', () => {
  const detail = read('components/StrategyDetailPage.tsx');
  assert.match(detail, /Back to Strategies/);
  assert.match(detail, /Edit strategy/);
  assert.match(detail, /Duplicate/);
  assert.match(detail, /handleBackToStrategies/);
  assert.match(detail, /handleEditStrategy/);
  assert.match(detail, /handleDuplicateStrategy/);
  assert.match(detail, /window\.location\.assign\(`\/profile\?strategy=\$\{encodeURIComponent\(strategy\.id\)\}&mode=edit`\)/);
  assert.match(detail, /window\.location\.assign\(`\/profile\?strategy=\$\{encodeURIComponent\(strategy\.id\)\}&mode=duplicate`\)/);

  const builder = read('components/StrategyBuilder.tsx');
  assert.match(builder, /const selectedStrategyId = searchParams\.get\('strategy'\);/);
  assert.match(builder, /const requestedMode = searchParams\.get\('mode'\);/);
  assert.match(builder, /if \(requestedMode === 'duplicate'\)/);
  assert.match(builder, /if \(requestedMode === 'edit'\)/);
  assert.match(builder, /requestOpenProfile\(item\)/);
});

test('strategy detail tabs keep a single full-width layout contract', () => {
  const detail = read('components/StrategyDetailPage.tsx');
  const stylesheet = read('app/trade-police.css');

  assert.match(detail, /strategy-detail-panel/);
  assert.match(detail, /strategy-detail-tab-panel/);
  assert.match(detail, /strategy-detail-section-card/);
  assert.match(stylesheet, /\.strategy-detail-panel\{[^}]*width:\s*100%/);
  assert.match(stylesheet, /\.strategy-detail-tab-panel\{[^}]*width:\s*100%/);
  assert.match(stylesheet, /\.strategy-detail-section-card\{[^}]*width:\s*100%/);
});

test('completion success card keeps a resilient responsive container and title layout', () => {
  const component = read('components/StrategyLearningConfirmation.tsx');
  const stylesheet = read('app/trade-police.css');

  assert.match(component, /strategy-complete-card/);
  assert.match(component, /strategy-complete-hero/);
  assert.match(stylesheet, /\.strategy-complete-card\{[^}]*width:\s*min\(100%/);
  assert.match(stylesheet, /\.strategy-complete-hero\{[^}]*min-width:\s*0/);
  assert.match(stylesheet, /overflow-wrap:\s*anywhere|word-break:\s*break-word/);
});
