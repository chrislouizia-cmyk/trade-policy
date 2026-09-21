import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260921175426_hq_customer_data_integrity.sql'),
  'utf8',
);
const directory = fs.readFileSync(path.join(root, 'components/hq/CustomerDirectory.tsx'), 'utf8');
const customerPage = fs.readFileSync(path.join(root, 'app/hq/customers/[id]/page.tsx'), 'utf8');
const customerError = fs.readFileSync(path.join(root, 'app/hq/customers/[id]/error.tsx'), 'utf8');
const notesPanel = fs.readFileSync(path.join(root, 'components/hq/CustomerNotesPanel.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'components/hq/WorkspaceDashboard.tsx'), 'utf8');
const supportPage = fs.readFileSync(path.join(root, 'app/hq/support/page.tsx'), 'utf8');
const supportQueue = fs.readFileSync(path.join(root, 'components/hq/SupportTicketQueue.tsx'), 'utf8');

test('customer directory excludes staff and gates trading aggregates at the database boundary', () => {
  const rpc = migration.match(
    /create or replace function public\.staff_customer_directory_v2[\s\S]*?grant execute on function public\.staff_customer_directory_v2\(text,integer,integer,text,text\) to authenticated;/,
  )?.[0] ?? '';
  assert.match(rpc, /can_view_trading:=public\.has_staff_permission\('customers\.view_trading'\)/);
  assert.match(rpc, /not exists\(select 1 from public\.staff_roles sr where sr\.user_id=p\.id\)/);
  assert.match(rpc, /case when can_view_trading then coalesce\(s\.strategy_count,0\) else null end/);
  assert.match(rpc, /'tradingDataAvailable',can_view_trading/);
  assert.doesNotMatch(rpc, /coalesce\(s\.strategy_count,0\) strategy_count/);
});

test('directory UI distinguishes restricted fields from real zero values', () => {
  assert.match(directory, /canViewTrading \? customer\.account_count : "Restricted"/);
  assert.match(directory, /canViewTrading \? customer\.analysis_count : "Restricted"/);
  assert.match(directory, /canViewTrading \? readable\(customer\.active_strategy\) : "Restricted"/);
});

test('customer notes are permission checked, MFA protected, validated, and audited', () => {
  const rpc = migration.match(
    /create or replace function public\.staff_customer_note_create[\s\S]*?grant execute on function public\.staff_customer_note_create\(uuid,text\) to authenticated;/,
  )?.[0] ?? '';
  assert.match(rpc, /has_staff_permission\('support\.manage'\)/);
  assert.match(rpc, /has_staff_permission\('sales\.manage'\)/);
  assert.match(rpc, /Multi-factor authentication required/);
  assert.match(rpc, /length\(trim\(p_note\)\)>2000/);
  assert.match(rpc, /'CREATE_CUSTOMER_NOTE'/);
  assert.match(notesPanel, /staff_customer_note_create/);
  assert.match(notesPanel, /No internal notes recorded/);
});

test('Customer 360 uses real compliance cases and does not render a placeholder flag section', () => {
  assert.match(migration, /'flags',case when can_view_compliance/);
  assert.match(migration, /from public\.compliance_cases cc where cc\.customer_user_id=p\.id/);
  assert.match(customerPage, /Compliance Flags/);
  assert.doesNotMatch(customerPage, /No permitted internal flags are available/);
});

test('customer profile identifies failing RPCs and keeps optional Sales data fail-soft', () => {
  assert.match(customerPage, /\[HQ_CUSTOMER_RPC_FAILED\]/);
  for (const operation of [
    'staff_customer_360',
    'staff_customer_operational_detail',
    'staff_customer_feedback_detail',
    'staff_sales_email_drafts_v2',
  ]) assert.match(customerPage, new RegExp(operation));
  assert.doesNotMatch(customerPage, /Customer Sales drafts could not be loaded/);
  assert.match(customerPage, /Sales drafts are temporarily unavailable/);
  assert.match(customerError, /Customer profile could not be loaded/);
  assert.doesNotMatch(customerError, /Customer directory could not be loaded/);
});

test('customer profile traces and bounds every remote loading step', () => {
  assert.match(customerPage, /HQ_CUSTOMER_STEP_TIMEOUT_MS = 12_000/);
  assert.match(customerPage, /Promise\.race/);
  assert.match(customerPage, /\[HQ_CUSTOMER_STEP_STARTED\]/);
  assert.match(customerPage, /\[HQ_CUSTOMER_STEP_COMPLETED\]/);
  assert.match(customerPage, /\[HQ_CUSTOMER_STEP_FAILED\]/);
  for (const operation of [
    'get_hq_context',
    'get_mfa_assurance',
    'staff_customer_360',
    'staff_customer_operational_detail',
    'staff_customer_feedback_detail',
    'staff_sales_email_drafts_v2',
  ]) assert.match(customerPage, new RegExp(operation));
  assert.match(customerPage, /staff_customer_operational_detail[\s\S]*?catch\(unavailableCustomerRpcResult\)/);
  assert.match(customerPage, /staff_customer_feedback_detail[\s\S]*?catch\(unavailableCustomerRpcResult\)/);
  assert.match(customerPage, /staff_sales_email_drafts_v2[\s\S]*?catch\(unavailableCustomerRpcResult\)/);
});

test('feedback operations use permission profiles rather than legacy role allowlists', () => {
  const queue = migration.match(
    /create or replace function public\.staff_feedback_queue[\s\S]*?create or replace function public\.update_feedback_ticket/,
  )?.[0] ?? '';
  const update = migration.match(
    /create or replace function public\.update_feedback_ticket[\s\S]*?grant execute on function public\.staff_feedback_queue\(\),public\.update_feedback_ticket/,
  )?.[0] ?? '';
  assert.match(queue, /has_staff_permission\('feedback\.view'\)/);
  assert.match(update, /has_staff_permission\('support\.manage'\)/);
  assert.doesNotMatch(queue, /current_staff_role/);
  assert.doesNotMatch(update, /current_staff_role/);
});

test('workspace metrics do not turn missing data into trustworthy zeroes', () => {
  assert.match(workspace, /available=typeof value==='number'/);
  assert.match(workspace, /available\?String\(value\):'—'/);
  assert.doesNotMatch(workspace, /overview\[key\]\?\?0/);
});

test('Support workspace exposes canonical support tickets instead of routing every metric to beta feedback', () => {
  const readRpc = migration.match(
    /create or replace function public\.staff_support_queue[\s\S]*?create or replace function public\.staff_support_ticket_action/,
  )?.[0] ?? '';
  const actionRpc = migration.match(
    /create or replace function public\.staff_support_ticket_action[\s\S]*?grant execute on function public\.staff_support_queue\(\),public\.staff_support_ticket_action/,
  )?.[0] ?? '';
  assert.match(readRpc, /has_staff_permission\('support\.view'\)/);
  assert.match(actionRpc, /has_staff_permission\('support\.manage'\)/);
  assert.match(actionRpc, /A resolution note is required/);
  assert.match(actionRpc, /'UPDATE_SUPPORT_TICKET'/);
  assert.match(supportPage, /staff_support_queue/);
  assert.match(supportPage, /staff_feedback_queue/);
  assert.match(supportQueue, /staff_support_ticket_action/);
});
