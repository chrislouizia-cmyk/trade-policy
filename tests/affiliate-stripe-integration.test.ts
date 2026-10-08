import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import {
  affiliateEligibleAmountMinor,
  affiliateInvoicePaidAt,
} from '../lib/billing/affiliate-invoice.ts';

const webhook = fs
  .readFileSync('app/api/billing/webhook/route.ts', 'utf8')
  .replace(/\s+/g, ' ')
  .toLowerCase();

test('affiliate amount uses money actually paid and excludes Stripe taxes', () => {
  const invoice = {
    amount_paid: 10_000,
    total: 10_000,
    total_taxes: [{amount: 1_600}],
  } as any;

  assert.equal(affiliateEligibleAmountMinor(invoice), 8_400);
});

test('partial collection removes only proportional tax', () => {
  const invoice = {
    amount_paid: 5_000,
    total: 10_000,
    total_taxes: [{amount: 1_600}],
  } as any;

  assert.equal(affiliateEligibleAmountMinor(invoice), 4_200);
});

test('discounted invoice commissions only the amount actually collected', () => {
  const invoice = {
    amount_paid: 7_500,
    total: 7_500,
    total_taxes: [],
    subtotal: 10_000,
  } as any;

  assert.equal(affiliateEligibleAmountMinor(invoice), 7_500);
});

test('zero-dollar paid invoices do not establish affiliate earnings', () => {
  assert.equal(
    affiliateEligibleAmountMinor({
      amount_paid: 0,
      total_taxes: [],
    } as any),
    0,
  );
});

test('paid timestamp uses Stripe paid_at rather than webhook arrival', () => {
  assert.equal(
    affiliateInvoicePaidAt(
      {
        status_transitions: {paid_at: 1_700_000_000},
      } as any,
      1_800_000_000,
    ),
    new Date(1_700_000_000 * 1000).toISOString(),
  );
});

test('invoice.paid records affiliate commission after billing sync', () => {
  assert.match(
    webhook,
    /if\(subscriptionid\)await currentsubscription\(admin,subscriptionid,event\); if\(event\.type==='invoice\.paid'\)/,
  );

  assert.match(
    webhook,
    /recordaffiliateinvoicecommission/,
  );

  assert.match(
    webhook,
    /record_affiliate_commission/,
  );
});

test('affiliate commission resolves canonical referred user from billing binding', () => {
  assert.match(
    webhook,
    /bindingfor\(admin,customerid,undefined\)/,
  );

  assert.match(
    webhook,
    /affiliate_referrals/,
  );

  assert.match(
    webhook,
    /referred_user_id/,
  );
});

test('affiliate commission uses Stripe invoice id as economic idempotency key', () => {
  assert.match(
    webhook,
    /p_stripe_invoice_id:invoice\.id/,
  );
});

test('outside twelve-month window is a normal no-commission outcome', () => {
  assert.match(
    webhook,
    /affiliate_commission_outside_eligibility_window/,
  );
});

test('invoice.payment_failed never records affiliate earnings', () => {
  const branch =
    webhook.slice(
      webhook.indexOf("event.type==='invoice.paid'||event.type==='invoice.payment_failed'"),
    );

  assert.match(
    branch,
    /if\(event\.type==='invoice\.paid'\)/,
  );
});
