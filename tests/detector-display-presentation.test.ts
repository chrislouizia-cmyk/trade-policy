import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDetectorDisplayItems, toSafeDetectorDisplayModel } from '../lib/decision-presentation/detector-display.ts';

test('redacts encoded detector payloads and keeps a safe fallback label', () => {
  const item = toSafeDetectorDisplayModel('%7B%22detector%22%3A%22liquiditySweep%22%7D');
  assert.ok(item);
  assert.equal(item?.humanLabel, 'Additional automatic confirmation is pending.');
  assert.equal(item?.title, 'Automatic detector review required');
});

test('renders known detector values as human-readable labels', () => {
  const item = toSafeDetectorDisplayModel('h4TrendAligned');
  assert.ok(item);
  assert.equal(item?.humanLabel, 'H4 trend aligned');
});

test('builds display items from mixed values without exposing raw payloads', () => {
  const items = buildDetectorDisplayItems(['fairValueGap', '%7B%22payload%22%3A%22secret%22%7D', 'unknown detector']);
  assert.equal(items.length, 3);
  assert.equal(items[0]?.humanLabel, 'Fair value gap');
  assert.equal(items[1]?.humanLabel, 'Additional automatic confirmation is pending.');
  assert.equal(items[2]?.humanLabel, 'unknown detector');
});
