# Stripe Billing Setup

## Product and price

1. In Stripe test mode, create one product named **Trade Police Pro**.
2. Create one recurring monthly price in the launch currency and copy its `price_...` identifier to `STRIPE_PRO_MONTHLY_PRICE_ID`.
3. Keep Team without a price or Checkout link. Display copy and Stripe identifiers are intentionally separate.
4. Configure the Customer Portal to allow payment-method updates, invoice viewing, and subscription cancellation at period end.

## Environment

Set these separately in local, Vercel Preview, and Vercel Production:

- `BILLING_ENABLED=true`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `NEXT_PUBLIC_APP_URL`

Use test keys and a test price in Preview. Use live values only after test-mode approval. With `BILLING_ENABLED=false`, billing APIs fail closed while the application still builds.

## Database and webhook

Apply `supabase/migrations/039_secure_stripe_billing.sql`. Register `${NEXT_PUBLIC_APP_URL}/api/billing/webhook` and subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The endpoint verifies the raw request body with `STRIPE_WEBHOOK_SECRET`, records processed event IDs, and retrieves current subscription state for invoice events. Clients can read only their own subscription/usage rows and cannot write billing state.

## Local test

1. Run the app with Stripe test variables.
2. Run `stripe listen --forward-to localhost:3000/api/billing/webhook` and use its signing secret.
3. Sign in as a Free customer, start Checkout, and use Stripe test card `4242 4242 4242 4242` with any future expiry and CVC.
4. Confirm the success page initially treats the return as non-authoritative, then Account becomes Pro after the verified webhook.
5. Use Stripe CLI fixtures or Dashboard actions to test payment failure, cancellation-at-period-end, deletion, duplicate delivery, and portal return.

## Production activation

Apply the migration, configure the live product/price and Portal, add the live webhook, verify signatures in Preview, complete a full test-mode checkout, then replace Preview-independent Production variables with live values. Verify the Vercel function uses the Node.js runtime and that Stripe receives prompt `2xx` responses.

Refunds do not automatically cancel a subscription. Operations must follow the approved refund policy and separately cancel or retain access. Cancellation state follows the current Stripe subscription delivered by webhooks.

## Rollback and disable

Set `BILLING_ENABLED=false`, redeploy, and disable new Checkout. Existing server entitlements remain readable; do not delete subscription records. Roll back the application through Vercel and use a forward database migration for schema corrections. Reconcile Stripe subscriptions before re-enabling billing.
