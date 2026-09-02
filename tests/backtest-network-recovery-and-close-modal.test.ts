import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detail = readFileSync(new URL('../components/StrategyDetailPage.tsx', import.meta.url), 'utf8');
const closeModal = readFileSync(new URL('../components/CloseTradeModal.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/trade-police.css', import.meta.url), 'utf8');

test('running and interrupted backtests reconnect automatically without exposing Failed to fetch', () => {
  assert.match(detail, /payload\?\.status === 'RUNNING'[\s\S]*executeQueuedRun\(runId\)/);
  assert.match(detail, /connection was interrupted, but the backtest is safe\. Reconnecting automatically/);
  assert.match(detail, /window\.setTimeout\(\(\) => \{ void executeQueuedRun\(runId\); \}, 15_000\)/);
  assert.doesNotMatch(detail, /setMessage\(error instanceof Error \? error\.message/);
});

test('close trade dialog is portalled into a viewport-fixed scroll container', () => {
  assert.match(closeModal, /createPortal\([\s\S]*document\.body\)/);
  assert.match(closeModal, /document\.body\.style\.overflow='hidden'/);
  assert.match(closeModal, /event\.key==='Escape'/);
  assert.match(closeModal, /aria-labelledby="close-trade-title"/);
  assert.match(styles, /\.close-trade-modal-backdrop\{position:fixed;inset:0;[\s\S]*place-items:center;[\s\S]*height:100dvh/);
  assert.match(styles, /\.close-trade-modal\{[\s\S]*max-height:calc\(100dvh - 32px\);[\s\S]*overflow:hidden/);
  assert.match(styles, /\.close-trade-modal-body\{[\s\S]*overflow-y:auto/);
});
