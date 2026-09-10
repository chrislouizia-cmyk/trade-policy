import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/110_affiliate_hq_management.sql',
  'utf8'
);

const api = fs.readFileSync(
  'app/api/hq/affiliates/route.ts',
  'utf8'
);

const page = fs.readFileSync(
  'app/hq/affiliates/page.tsx',
  'utf8'
);

const queue = fs.readFileSync(
  'components/hq/AffiliateQueue.tsx',
  'utf8'
);

const nav = fs.readFileSync(
  'components/hq/HQNav.tsx',
  'utf8'
);

test('affiliate management has a dedicated sensitive HQ permission', () => {
  assert.match(migration, /'affiliate\.manage'/);
  assert.match(
    migration,
    /Review and manage Affiliate Program participants/
  );
  assert.match(migration, /true/);
});

test('affiliate management permission is granted to OWNER', () => {
  assert.match(
    migration,
    /values\s*\(\s*'OWNER'\s*,\s*'affiliate\.manage'\s*\)/i
  );
});

test('HQ affiliate queue checks staff permission inside database authority', () => {
  assert.match(
    migration,
    /has_staff_permission\('affiliate\.manage'\)/
  );
  assert.match(
    migration,
    /AFFILIATE_MANAGEMENT_PERMISSION_DENIED/
  );
});

test('HQ review supports the intended affiliate lifecycle only', () => {
  for (const decision of [
    'APPROVE',
    'REJECT',
    'SUSPEND',
    'REACTIVATE',
  ]) {
    assert.match(migration, new RegExp(`'${decision}'`));
  }

  assert.match(
    migration,
    /AFFILIATE_APPROVAL_REQUIRES_PENDING/
  );
  assert.match(
    migration,
    /AFFILIATE_REJECTION_REQUIRES_PENDING/
  );
  assert.match(
    migration,
    /AFFILIATE_SUSPENSION_REQUIRES_APPROVED/
  );
  assert.match(
    migration,
    /AFFILIATE_REACTIVATION_REQUIRES_SUSPENDED/
  );
});

test('HQ affiliate decisions create canonical audit events', () => {
  assert.match(
    migration,
    /record_affiliate_audit_event/
  );
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /HQ_/);
});

test('HQ functions are exposed only through authenticated staff boundary', () => {
  assert.match(
    migration,
    /revoke all on function public\.staff_affiliate_queue\(text\)[\s\S]*from public, anon/i
  );
  assert.match(
    migration,
    /grant execute on function public\.staff_affiliate_queue\(text\)[\s\S]*to authenticated/i
  );

  assert.match(
    migration,
    /revoke all on function public\.staff_review_affiliate\(uuid, text, text\)[\s\S]*from public, anon/i
  );
  assert.match(
    migration,
    /grant execute on function public\.staff_review_affiliate\(uuid, text, text\)[\s\S]*to authenticated/i
  );
});

test('HQ API authenticates and delegates reads to database RPC', () => {
  assert.match(api, /supabase\.auth\.getUser\(\)/);
  assert.match(api, /staff_affiliate_queue/);
});

test('HQ API validates decisions before delegating mutation', () => {
  assert.match(
    api,
    /z\.enum\(\['APPROVE', 'REJECT', 'SUSPEND', 'REACTIVATE'\]\)/
  );
  assert.match(api, /staff_review_affiliate/);
});

test('affiliate HQ page requires affiliate.manage', () => {
  assert.match(page, /getHQContext\('affiliate\.manage'\)/);
});

test('affiliate HQ queue exposes review actions', () => {
  assert.match(queue, /Approve/);
  assert.match(queue, /Reject/);
  assert.match(queue, /Suspend/);
  assert.match(queue, /Reactivate/);
});

test('affiliate HQ navigation is permission gated', () => {
  assert.match(
    nav,
    /\['Affiliates','\/hq\/affiliates','affiliate\.manage'\]/
  );
});
