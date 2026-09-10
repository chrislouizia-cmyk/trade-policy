import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const webhook = fs
  .readFileSync('app/api/billing/webhook/route.ts', 'utf8')
  .replace(/\s+/g, ' ')
  .toLowerCase();

test('refund.created enters affiliate adjustment flow', () => {
  assert.match(
    webhook,
    /event\.type==='refund\.created'/,
  );

  assert.match(
    webhook,
    /processaffiliaterefund/,
  );
});

test('refund uses Stripe refund id as business idempotency source', () => {
  assert.match(
    webhook,
    /sourcetype:'refund'/,
  );

  assert.match(
    webhook,
    /sourceid:refund\.id/,
  );
});

test('refund resolves invoice through canonical PaymentIntent invoice payment', () => {
  assert.match(
    webhook,
    /paymentintentid=id\(refund\.payment_intent\).*id\(charge\.payment_intent\)/,
  );

  assert.match(
    webhook,
    /stripe\.invoicepayments\.list/,
  );

  assert.match(
    webhook,
    /type:'payment_intent'/,
  );

  assert.match(
    webhook,
    /payment_intent:paymentintentid/,
  );

  assert.match(
    webhook,
    /id\(payment\.invoice\)/,
  );
});

test('affiliate adjustment flow does not scan arbitrary Stripe invoices', () => {
  assert.doesNotMatch(
    webhook,
    /stripe\.invoices\.list/,
  );

  assert.doesNotMatch(
    webhook,
    /invoiceidforcharge/,
  );
});

test('dispute only reverses commission after Stripe closes it lost', () => {
  assert.match(
    webhook,
    /event\.type==='charge\.dispute\.closed'/,
  );

  assert.match(
    webhook,
    /if\(dispute\.status!=='lost'\)return/,
  );
});

test('lost dispute has independent idempotency identity', () => {
  assert.match(
    webhook,
    /sourcetype:'chargeback'/,
  );

  assert.match(
    webhook,
    /sourceid:dispute\.id/,
  );
});

test('refund and chargeback use proportional source amount and charge total', () => {
  assert.match(
    webhook,
    /sourceamountminor/,
  );

  assert.match(
    webhook,
    /sourcetotalminor/,
  );

  assert.match(
    webhook,
    /charge\.amount/,
  );
});

test('affiliate financial adjustment is delegated to database authority', () => {
  assert.match(
    webhook,
    /record_affiliate_system_adjustment/,
  );
});

test('affiliate refund reverses commission only after Stripe reports succeeded', () => {
  assert.match(
    webhook,
    /if\(refund\.status!=='succeeded'\)return;/,
  );
});

test('refund.updated captures pending to succeeded refund transitions', () => {
  assert.match(
    webhook,
    /event\.type==='refund\.created'\s*\|\|\s*event\.type==='refund\.updated'/,
  );
});

test('invoice paid reconciles successful refunds that arrived before commission creation', () => {
  assert.match(
    webhook,
    /await reconcileaffiliaterefundsforinvoice\(admin,invoice\);/,
  );

  assert.match(
    webhook,
    /if\(refund\.status==='succeeded'\)\{\s*await processaffiliaterefund\(admin,refund\);/,
  );
});

test('refund reconciliation is scoped to the invoice payment intent', () => {
  assert.match(
    webhook,
    /stripe\.charges\.list\(\{\s*payment_intent:paymentintentid,\s*limit:10/,
  );

  assert.match(
    webhook,
    /stripe\.refunds\.list\(\{\s*charge:charge\.id,\s*limit:100/,
  );
});
