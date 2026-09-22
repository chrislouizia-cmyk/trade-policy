import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync('app/hq/page.tsx', 'utf8');

test('HQ owner home degrades gracefully when one summary RPC fails', () => {
  assert.doesNotMatch(source, /throw new Error\(`HQ command center failed/);
  assert.doesNotMatch(source, /throw new Error\(`HQ customer summary failed/);

  assert.match(source, /commandCenterError\?null:/);
  assert.match(source, /customerError\?\[\]:/);
  assert.match(source, /loadError=\{commandCenterError\?/);
});

test('HQ owner home records partial RPC failures for diagnostics', () => {
  assert.match(source, /\[HQ_COMMAND_CENTER_FAILED\]/);
  assert.match(source, /\[HQ_CUSTOMER_SUMMARY_FAILED\]/);
});
