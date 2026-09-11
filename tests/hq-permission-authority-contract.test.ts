import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const hqContext = fs.readFileSync('lib/hq-page.tsx', 'utf8');
const marketplace = fs.readFileSync('lib/server/hq-marketplace.ts', 'utf8');

test('HQ navigation permissions come only from canonical staff permission authority', () => {
  assert.doesNotMatch(hqContext, /permissions\.push\(['"]marketplace\.lab['"]\)/);
  assert.match(hqContext, /current_staff_permissions/);
});

test('Marketplace HQ requires marketplace.lab directly', () => {
  assert.match(
    marketplace,
    /has_staff_permission'\s*,\s*\{p_permission:'marketplace\.lab'\}/
  );
  assert.doesNotMatch(marketplace, /marketplacePermissions\.push\(['"]marketplace\.lab['"]\)/);
});

test('Marketplace no longer derives access indirectly from owner sales or compliance', () => {
  assert.doesNotMatch(marketplace, /is_owner/);
  assert.doesNotMatch(marketplace, /p_permission:'sales\.view'/);
  assert.doesNotMatch(marketplace, /p_permission:'compliance\.view'/);
});
