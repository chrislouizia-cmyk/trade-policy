import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/113_canonical_marketplace_lab_permission.sql',
  'utf8'
);

const hqPage = fs.readFileSync('lib/hq-page.tsx', 'utf8');
const marketplaceServer = fs.readFileSync(
  'lib/server/hq-marketplace.ts',
  'utf8'
);

test('marketplace.lab exists as a canonical sensitive permission', () => {
  assert.match(migration, /'marketplace\.lab'/);
  assert.match(
    migration,
    /Access internal Marketplace Lab review and simulation tools/
  );
  assert.match(migration, /true\s*\)/);
});

test('marketplace.lab is granted only to intended internal roles', () => {
  assert.match(migration, /\('OWNER', 'marketplace\.lab'\)/);
  assert.match(migration, /\('HEAD_OF_SALES', 'marketplace\.lab'\)/);
  assert.match(migration, /\('COMPLIANCE_OFFICER', 'marketplace\.lab'\)/);

  assert.doesNotMatch(migration, /\('SUPPORT', 'marketplace\.lab'\)/);
  assert.doesNotMatch(migration, /\('TECHNICIAN', 'marketplace\.lab'\)/);
  assert.doesNotMatch(migration, /\('SECURITY_ADMIN', 'marketplace\.lab'\)/);
});

test('database marketplace authority delegates only to canonical permission', () => {
  assert.match(
    migration,
    /select public\.has_staff_permission\('marketplace\.lab'\)/
  );

  assert.doesNotMatch(
    migration,
    /has_staff_permission\('sales\.view'\)/
  );

  assert.doesNotMatch(
    migration,
    /has_staff_permission\('compliance\.view'\)/
  );

  assert.doesNotMatch(
    migration,
    /is_owner\(\)\s+or/i
  );
});

test('HQ navigation and server marketplace access use marketplace.lab directly', () => {
  assert.doesNotMatch(
    hqPage,
    /permissions\.push\(['"]marketplace\.lab['"]\)/
  );

  assert.match(
    marketplaceServer,
    /has_staff_permission/
  );

  assert.match(
    marketplaceServer,
    /marketplace\.lab/
  );
});
