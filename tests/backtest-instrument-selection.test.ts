import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  normalizeStrategyInstruments,
  resolveBacktestInstrument,
} from '../lib/backtesting/instrument-selection.ts';

test('a stale instrument is replaced with the first instrument enabled for the current strategy', () => {
  assert.equal(resolveBacktestInstrument('GBPUSD', ['XAUUSD']), 'XAUUSD');
});

test('a valid current instrument is preserved and normalized', () => {
  assert.equal(resolveBacktestInstrument(' xauusd ', ['XAUUSD', 'GBPUSD']), 'XAUUSD');
});

test('instrument normalization removes blanks and duplicates without inventing a fallback', () => {
  assert.deepEqual(normalizeStrategyInstruments([' XAUUSD ', '', 'xauusd', 'GBPUSD']), ['XAUUSD', 'GBPUSD']);
  assert.equal(resolveBacktestInstrument('GBPUSD', []), '');
});

test('strategy detail synchronizes the visible selector and revalidates it before submission', () => {
  const detail = fs.readFileSync('components/StrategyDetailPage.tsx', 'utf8');

  assert.match(detail, /resolveBacktestInstrument\(current\.instrument, enabledBacktestInstruments\)/);
  assert.match(detail, /\[strategy\.id, enabledBacktestInstrumentKey\]/);
  assert.match(detail, /instrument: selectedInstrument/);
  assert.match(detail, /enabledBacktestInstruments\.length === 0/);
  assert.doesNotMatch(detail, /strategy\.instruments \?\? \['XAUUSD'\]/);
});
