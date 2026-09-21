import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync(
  'supabase/migrations/20260921065737_harden_hq_customer_access_mfa.sql',
  'utf8',
);
const customerPage = fs.readFileSync('app/hq/customers/[id]/page.tsx', 'utf8');
const customerReport = fs.readFileSync(
  'app/api/hq/customers/[id]/report/route.ts',
  'utf8',
);
const hqContext = fs.readFileSync('lib/hq-page.tsx', 'utf8');
const login = fs.readFileSync('components/hq/HQLoginForm.tsx', 'utf8');
const mfaPage = fs.readFileSync('app/hq/mfa/page.tsx', 'utf8');
const mfaForm = fs.readFileSync('components/hq/HQMfaForm.tsx', 'utf8');

test('customer trading data has a dedicated sensitive permission owned by the owner by default', () => {
  assert.match(migration, /'customers\.view_trading',[\s\S]*true/);
  assert.match(migration, /values\('OWNER','customers\.view_trading'\)/);
  assert.match(migration, /where role_key='OWNER'/);
  assert.doesNotMatch(migration, /values\('(?:SUPPORT|HEAD_OF_SALES|SECURITY_ADMIN)','customers\.view_trading'\)/);
});

test('canonical permission authority uses permission profiles and denies MFA-required staff at AAL1', () => {
  assert.match(migration, /join public\.permission_profile_permissions ppp/);
  assert.match(migration, /ppp\.permission_key=p_permission/);
  assert.match(migration, /not sr\.mfa_required or coalesce\(auth\.jwt\(\)->>'aal','aal1'\)='aal2'/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.has_staff_permission[\s\S]*?\$\$;/)?.[0] ?? '',
    /join public\.role_permissions/,
  );
});

test('operational customer RPC enforces permission MFA staff exclusion and audit logging', () => {
  const rpc = migration.match(
    /create or replace function public\.staff_customer_operational_detail[\s\S]*?grant execute on function public\.staff_customer_operational_detail\(uuid\) to authenticated;/,
  )?.[0] ?? '';
  assert.match(rpc, /has_staff_permission\('customers\.view_trading'\)/);
  assert.match(rpc, /auth\.jwt\(\)->>'aal'/);
  assert.match(rpc, /exists\(select 1 from public\.staff_roles where user_id=p_customer_id and is_active\)/);
  assert.match(rpc, /VIEW_CUSTOMER_TRADING_DETAIL/);
  assert.match(rpc, /revoke all[\s\S]*from public,anon/);
});

test('metadata-only Customer 360 does not disclose trading aggregates', () => {
  const rpc = migration.match(
    /create or replace function public\.staff_customer_360[\s\S]*?grant execute on function public\.staff_customer_360\(uuid\) to authenticated;/,
  )?.[0] ?? '';
  assert.match(rpc, /can_view_trading:=public\.has_staff_permission\('customers\.view_trading'\)/);
  assert.match(rpc, /'strategy_count',case when can_view_trading/);
  assert.match(rpc, /'account_count',case when can_view_trading/);
  assert.match(rpc, /'analysis_count',case when can_view_trading/);
  assert.match(rpc, /customer_notes cn where cn\.customer_user_id=p\.id and can_view_trading/);
  assert.match(rpc, /customer_follow_ups cf where cf\.customer_user_id=p\.id and can_view_sales/);
  assert.match(rpc, /support_tickets st where st\.customer_user_id=p\.id and can_view_support/);
  assert.match(customerPage, /\["Strategies", canViewTrading \? customer\.strategy_count \?\? 0 : "Restricted"\]/);
});

test('Customer 360 only requests sensitive datasets when the caller has trading permission and AAL2', () => {
  assert.match(customerPage, /permissions\.includes\("customers\.view_trading"\) && hasAal2/);
  assert.match(customerPage, /canViewTrading[\s\S]*\? supabase\.rpc\("staff_customer_operational_detail"/);
  assert.match(customerPage, /Customer trading access is restricted/);
  assert.match(customerPage, /Strategy configuration is restricted/);
  assert.match(customerPage, /Trade history is restricted/);
});

test('customer report independently requires trading permission and AAL2', () => {
  assert.match(customerReport, /p_permission: "customers\.view_trading"/);
  assert.match(customerReport, /assurance\?\.currentLevel !== "aal2"/);
  assert.match(customerReport, /Multi-factor authentication required/);
});

test('HQ login enrollment and server context all enforce the MFA transition', () => {
  assert.match(login, /current_staff_mfa_requirement/);
  assert.match(login, /getAuthenticatorAssuranceLevel/);
  assert.match(login, /window\.location\.assign\('\/hq\/mfa'\)/);
  assert.match(hqContext, /redirect\('\/hq\/mfa'\)/);
  assert.match(mfaPage, /current_staff_mfa_requirement/);
  assert.match(mfaForm, /auth\.mfa\.enroll/);
  assert.match(mfaForm, /auth\.mfa\.challengeAndVerify/);
});
