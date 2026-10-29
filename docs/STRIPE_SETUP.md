# Stripe Billing Setup

## Product and price

1. In Stripe test mode, create one product named **Trade Police Pro**.
2. Create one active recurring Price for exactly **$29 USD**, billed every month with an interval count of one, and copy its `price_...` identifier to `STRIPE_PRO_MONTHLY_PRICE_ID`.
3. Keep Team without a price or Checkout link. Display copy and Stripe identifiers are intentionally separate.
4. Configure the Customer Portal to allow payment-method updates, invoice viewing, and subscription cancellation at period end.

## Environment

Set these separately in local, Vercel Preview, and Vercel Production:

- `BILLING_ENABLED=true`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_MONTHLY_PRICE_ID`
- `NEXT_PUBLIC_APP_URL`

Use test keys and a test price in Preview. Use live values only after test-mode approval. With `BILLING_ENABLED=false`, billing APIs fail closed while the application still builds.

The current integration redirects to server-created Checkout and Portal Sessions and does not load Stripe.js, so a publishable key is not required. Before Checkout opens, the server retrieves the configured Price from Stripe and verifies its identifier, active state, recurring type, monthly interval, interval count of one, USD currency, 2900 unit amount, expanded product, and Test/Live mode against the secret-key environment. Validation is cached for at most five minutes; failures close Checkout and entitlement processing without exposing Stripe errors.

## Database and webhook

Apply `supabase/migrations/039_secure_stripe_billing.sql` and `041_stripe_entitlement_hardening.sql`. Register `${NEXT_PUBLIC_APP_URL}/api/billing/webhook` and subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The endpoint verifies the raw request body with `STRIPE_WEBHOOK_SECRET`, atomically claims event IDs, and retrieves current subscription state for every entitlement-changing event. Claims move through `PROCESSING`, `PROCESSED`, or `FAILED`; completed duplicates return 2xx, concurrent processing returns a retryable non-2xx, and failed claims may be retried. Clients can read only their own subscription/usage rows and cannot write billing state.

Migration 041 persists verified Price/Product provenance. A subscription qualifies only when it has exactly the configured active $29 USD monthly Price in the same Stripe mode. Existing server-side customer bindings outrank metadata. Metadata can initialize a binding only when neither the customer nor user conflicts with an existing binding. Unexpected prices and identity conflicts are quarantined, never grant Pro, and are recorded only with allowlisted operational reason codes.

Out-of-order delivery is handled by retrieving the current Stripe subscription instead of trusting `event.created`. A missing subscription is conservatively canceled locally, so an older invoice cannot restore access. Entitlements remain: `active` and `trialing` are Pro; `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, and `canceled` are Free. Logs contain request/event identifiers and safe reason codes only—never request bodies, keys, payment methods, customer email, or complete Stripe errors.

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
