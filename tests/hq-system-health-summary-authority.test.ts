import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p:string) => fs.readFileSync(p,'utf8');

const migration = read(
  'supabase/migrations/115_system_health_summary_authority.sql'
);

const health = read(
  'app/api/hq/health/route.ts'
);

const audit = read(
  'app/api/hq/historical-reports/audit/route.ts'
);

test('system-health summary wrapper requires authenticated system.health authority', () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(
    migration,
    /has_staff_permission\('system\.health'\)/
  );
  assert.match(
    migration,
    /staff_private_beta_report_operations_summary_v1/
  );
});

test('health no longer uses service role for private beta operations summary', () => {
  assert.match(
    health,
    /supabase\.rpc\('staff_private_beta_report_operations_summary_v1'\)/
  );

  assert.doesNotMatch(
    health,
    /createAdminClient\(\)\.rpc\('private_beta_report_operations_summary'\)/
  );
});

test('historical report audit uses authenticated DB-authorized summary boundary', () => {
  assert.match(
    audit,
    /supabase\.rpc\('staff_private_beta_report_operations_summary_v1'\)/
  );

  assert.doesNotMatch(
    audit,
    /createAdminClient\(\)\.rpc\('private_beta_report_operations_summary'\)/
  );
});
