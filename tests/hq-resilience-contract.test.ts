import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync('app/hq/page.tsx', 'utf8');

test('HQ owner home degrades gracefully when one summary RPC fails', () => {
  assert.doesNotMatch(source, /throw new Error\(`HQ overview failed/);
  assert.doesNotMatch(source, /throw new Error\(`HQ customer summary failed/);
  assert.doesNotMatch(source, /throw new Error\(`HQ incidents failed/);

  assert.match(source, /overviewError\?\{\}:/);
  assert.match(source, /customerError\?\[\]:/);
  assert.match(source, /incidentError\?\[\]:/);
});

test('HQ owner home records partial RPC failures for diagnostics', () => {
  assert.match(source, /\[HQ_OVERVIEW_FAILED\]/);
  assert.match(source, /\[HQ_CUSTOMER_SUMMARY_FAILED\]/);
  assert.match(source, /\[HQ_INCIDENTS_FAILED\]/);
});
