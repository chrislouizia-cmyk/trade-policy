import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p:string) => fs.readFileSync(p,'utf8');

const migration = read(
  'supabase/migrations/114_marketplace_hq_authority_boundary.sql'
);

const catalog = read(
  'app/api/hq/marketplace/route.ts'
);

const listing = read(
  'app/api/hq/marketplace/[listingId]/route.ts'
);

test('internal release creation requires both marketplace.lab and founder authority in DB', () => {
  assert.match(migration, /staff_create_internal_marketplace_release_v2/);
  assert.match(migration, /has_staff_permission\('marketplace\.lab'\)/);
  assert.match(migration, /if not public\.is_owner\(\)/);
  assert.match(
    migration,
    /revoke execute on function public\.create_internal_marketplace_release_v1\(uuid,text,text\)[\s\S]*from authenticated/i
  );
});

test('HQ creation uses the authenticated guarded creation boundary', () => {
  assert.match(
    catalog,
    /rpc\('staff_create_internal_marketplace_release_v2'/
  );
  assert.doesNotMatch(
    catalog,
    /rpc\('create_internal_marketplace_release_v1'/
  );
});

test('marketplace review requires mutation authority, not compliance view authority', () => {
  assert.match(
    listing,
    /permissions\.includes\('compliance\.manage'\)/
  );
  assert.doesNotMatch(
    listing,
    /permissions\.includes\('compliance\.view'\)/
  );
  assert.doesNotMatch(
    listing,
    /rpc\('is_owner'\)/
  );
});

test('marketplace review mutation is authorized again inside the database', () => {
  assert.match(migration, /staff_review_marketplace_listing_v1/);
  assert.match(migration, /has_staff_permission\('marketplace\.lab'\)/);
  assert.match(migration, /has_staff_permission\('compliance\.manage'\)/);
  assert.match(migration, /auth\.uid\(\)/);

  assert.match(
    listing,
    /context\.supabase\.rpc\('staff_review_marketplace_listing_v1'/
  );

  assert.doesNotMatch(
    listing,
    /admin\.rpc\('staff_marketplace_transition_listing'/
  );
});
