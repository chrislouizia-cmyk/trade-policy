import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cache = fs.readFileSync('lib/server/backtest-historical-cache.ts', 'utf8');

test('historical cache reader paginates beyond Supabase default row limits', () => {
  assert.match(cache, /const PAGE_SIZE = 1000/);
  assert.match(cache, /\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(cache, /if \(page\.length < PAGE_SIZE\) break/);
  assert.match(cache, /from \+= PAGE_SIZE/);
});

test('pagination preserves deterministic chronological order', () => {
  assert.match(cache, /\.order\('opened_at', \{ ascending: true \}\)/);
});

test('historical cache pagination has a runaway safety bound', () => {
  assert.match(cache, /from > 250_000/);
});
