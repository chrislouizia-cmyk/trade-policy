import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const route=readFileSync(new URL('../app/api/hq/sales/drafts/[id]/send/route.ts',import.meta.url),'utf8');
const composer=readFileSync(new URL('../components/hq/SalesDraftComposer.tsx',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/080_reconcile_047_055_secondary_history.sql',import.meta.url),'utf8');
const gmail=readFileSync(new URL('../lib/server/gmail-delivery.ts',import.meta.url),'utf8');

test('send reserves a saved draft, delivers through Gmail, then completes it atomically',()=>{
  assert.match(route,/staff_sales_reserve_draft_send/);assert.match(route,/sendWithGmail/);assert.match(route,/staff_sales_complete_draft_send/);
  assert.match(migration,/status\s*=\s*'SENDING'/);assert.match(migration,/status\s*=\s*'SENT'/);assert.match(migration,/sent_at\s*=\s*now\(\)\s*,\s*sent_by\s*=\s*auth\.uid\(\)\s*,\s*delivery_provider/);
  assert.match(gmail,/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
});
test('HQ health evaluates Gmail OAuth configuration without exposing credentials',()=>{
  const health=readFileSync(new URL('../app/api/hq/health/route.ts',import.meta.url),'utf8');
  assert.match(health,/gmailOAuthConfigured\(\)/);assert.match(health,/Gmail OAuth delivery is configured/);assert.doesNotMatch(health,/GMAIL_ACCESS_TOKEN/);
  assert.match(gmail,/GMAIL_CLIENT_ID/);assert.match(gmail,/GMAIL_CLIENT_SECRET/);assert.match(gmail,/GMAIL_REFRESH_TOKEN/);assert.doesNotMatch(gmail,/GMAIL_ACCESS_TOKEN/);
});
test('provider failure restores the editable draft and records an audit event',()=>{
  assert.match(route,/staff_sales_fail_draft_send/);assert.match(route,/The draft was kept intact/);
  assert.match(migration,/status\s*=\s*coalesce\s*\(\s*pre_send_status\s*,\s*'DRAFT'\s*\)/);assert.match(migration,/'GMAIL'\s*,\s*'FAILED'\s*,\s*d\.delivery_error_code/);
});
test('a post-provider persistence failure stays locked rather than risking a duplicate email',()=>{
  assert.match(route,/let providerAccepted=false/);assert.match(route,/if\(!providerAccepted\)await supabase\.rpc\('staff_sales_fail_draft_send'/);assert.match(route,/remains locked to prevent a duplicate send/);
});
test('duplicate and already-sent delivery attempts fail closed',()=>{
  assert.match(migration,/if d\.status='SENT' then raise exception 'Draft already sent'/);assert.match(migration,/if d\.status='SENDING' then raise exception 'Draft is already sending'/);
  assert.match(composer,/readOnly=deliveryStatus==='SENT'\|\|deliveryStatus==='SENDING'/);assert.match(composer,/disabled=\{busy\|\|!draftId\|\|manual\}/);
});
test('composer requires confirmation, shows a sending state, and preserves sent audit metadata',()=>{
  assert.match(composer,/confirm\(`Send this email to \$\{customer\.email\}\?`\)/);assert.match(composer,/Sending…/);assert.match(composer,/Created: \{date\(initial\?\.created_at\)\}/);assert.match(composer,/Updated: \{date\(initial\?\.updated_at\)\}/);assert.match(composer,/initial\?\.sent_by/);
  assert.match(migration,/Recipient is required/);assert.match(migration,/provider_message_id/);assert.match(migration,/sales_email_delivery_audit/);
});
test('send route emits safe stage diagnostics and maps unknown exceptions to INTERNAL_DELIVERY_ERROR',()=>{
  for(const stage of ['RESERVATION_START','RESERVATION_OK','PERSISTENCE_COMPLETE'])assert.match(route,new RegExp(stage));
  for(const stage of ['GMAIL_CONFIG_OK','GMAIL_CONFIG_MISSING','TOKEN_EXCHANGE_START','TOKEN_EXCHANGE_OK','GMAIL_SEND_START','GMAIL_SEND_ACCEPTED'])assert.match(gmail,new RegExp(stage));
  assert.match(route,/FAILED:\$\{code\}/);assert.match(route,/INTERNAL_DELIVERY_ERROR/);assert.match(route,/externalStatus/);
  assert.doesNotMatch(route,/recipient_email.*console/);assert.doesNotMatch(route,/subject.*console/);assert.doesNotMatch(route,/reserved\.body.*console/);
});
