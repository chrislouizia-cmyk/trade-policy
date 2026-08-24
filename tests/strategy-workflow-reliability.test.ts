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
