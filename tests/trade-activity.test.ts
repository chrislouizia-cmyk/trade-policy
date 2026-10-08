import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTradeActivityDateTime, latestTradeActivity } from '../lib/trade-activity.ts';

test('recent trade activity is sorted newest first independently for each source', () => {
  const rows = [
    { id: 'old-executed', source: 'EXECUTED' as const, createdAt: '2026-09-01T18:00:00.000Z' },
    { id: 'suggested', source: 'SUGGESTED' as const, createdAt: '2026-09-01T22:00:00.000Z' },
    { id: 'new-executed', source: 'EXECUTED' as const, createdAt: '2026-09-01T22:38:00.000Z' },
    { id: 'middle-executed', source: 'EXECUTED' as const, createdAt: '2026-09-01T20:00:00.000Z' },
    { id: 'oldest-executed', source: 'EXECUTED' as const, createdAt: '2026-08-31T20:00:00.000Z' },
  ];

  assert.deepEqual(
    latestTradeActivity(rows, 'EXECUTED').map((row) => row.id),
    ['new-executed', 'middle-executed', 'old-executed'],
  );
  assert.deepEqual(latestTradeActivity(rows, 'SUGGESTED').map((row) => row.id), ['suggested']);
});

test('trade activity timestamps include both the local date and time', () => {
  const formatted = formatTradeActivityDateTime('2026-09-01T22:38:00.000Z', {
    locale: 'en-US',
    timeZone: 'UTC',
  });

  assert.match(formatted, /Sep 1, 2026/i);
  assert.match(formatted, /10:38 PM/i);
  assert.equal(formatTradeActivityDateTime('not-a-date'), 'Unknown date');
});
