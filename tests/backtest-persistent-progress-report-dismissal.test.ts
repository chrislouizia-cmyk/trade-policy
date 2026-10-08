import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('../components/StrategyDetailPage.tsx', import.meta.url), 'utf8');

test('backtest cards render persisted replay progress from zero through completion', () => {
  assert.match(detail, /metadata\?\.execution_progress_percent \?\? 0/);
  assert.match(detail, /Running historical replay · \$\{backtestProgress\(run\)\}%/);
  assert.match(detail, /run\.status === 'COMPLETED'\) return 100/);
  assert.match(detail, /role="progressbar"/);
  assert.match(detail, /aria-valuenow=\{backtestProgress\(run\)\}/);
});

test('backtest report uses a body portal and consumes dismissal pointer events', () => {
  assert.match(detail, /reportModalOpen && createPortal\(/);
  assert.match(detail, /closeRunReport\(event\?\: React\.SyntheticEvent\)/);
  assert.match(detail, /event\?\.preventDefault\(\)/);
  assert.match(detail, /event\?\.stopPropagation\(\)/);
  assert.match(detail, /onPointerDown=\{closeRunReport\}/);
  assert.match(detail, /document\.body\)/);
});
