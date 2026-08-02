# Private Beta Launch Checklist

## Configuration

- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the production Supabase project.
- [ ] Set `SUPABASE_SERVICE_ROLE_KEY` only in server-side Vercel environment variables. Never expose it to the browser.
- [ ] Set `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin.
- [ ] Set `TWELVE_DATA_API_KEY`; confirm quotas, provider symbols, request timeout behavior, and fresh-candle timestamps.
- [ ] Set `OPENAI_API_KEY` and `OPENAI_VISION_MODEL` only if optional explanations/chart interpretation are enabled. Confirm the deterministic result remains usable when AI is unavailable.
- [ ] Apply all Supabase migrations in order and verify RLS, authenticated redirect URLs, and the production Site URL.
- [ ] Add `${NEXT_PUBLIC_APP_URL}/auth/callback` to Supabase Auth redirect URLs.
- [ ] Configure a production SMTP provider, sender domain, confirmation template, recovery template, SPF, DKIM, and DMARC; test confirmation and password reset delivery.
- [ ] Billing: Stripe is not implemented. Keep Pro grants server-authoritative and controlled by beta operations. Do not advertise self-service checkout until checkout, signed webhooks, entitlements, failed-payment handling, and portal are implemented and tested.
- [ ] Link the Vercel project, select the production Supabase environment, add every variable separately for Preview and Production, and leave secrets unexposed.
- [ ] Add the production domain in Vercel, configure DNS, confirm TLS, set `NEXT_PUBLIC_APP_URL`, and update Supabase URL allowlists.

## Release verification

- [ ] Review `/legal` with qualified counsel and publish privacy, terms, cookie, and jurisdiction-specific disclosures before accepting paid users.
- [ ] Create a new customer account, confirm email, sign in, sign out, reset password, and verify a requested client destination survives login.
- [ ] Complete onboarding on desktop and 375 px mobile; refresh mid-flow and confirm stored profile fields remain.
- [ ] Create, save, reopen, duplicate, and activate a Strategy DNA. Confirm all fields are unchanged and unsupported mandatory rules do not pass.
- [ ] Run analysis during an open market and confirm instrument, active strategy, data timestamp, evidence, readiness, and decision status.
- [ ] Test a closed-market response: no 0% readiness and no READY result.
- [ ] Disable or invalidate the market-data provider key and confirm DATA UNAVAILABLE, no 0%, and never READY.
- [ ] Save a decision, open History, and confirm date, instrument, setup, decision, readiness, and result state.
- [ ] Test 375, 430, 768, 1024, and desktop widths: no horizontal overflow, clipped dialog, covered content, or touch target below 44 px on primary paths.
- [ ] Billing test is blocked until Stripe exists. Until then, verify the Account page cannot change plan or entitlement client-side.
- [ ] Sign in as a normal customer and request every `/hq`, `/admin`, `/staff`, `/api/hq`, and `/api/admin` route. Confirm no internal data is returned.
- [ ] Sign in as each staff permission profile and verify only granted HQ routes and actions work.
- [ ] Run `npm test`, `npx tsc --noEmit`, `npm run build`, and `git diff --check`.
- [ ] Deploy a Vercel Preview and repeat account, strategy, analysis, provider-failure, mobile, and HQ permission smoke tests against production-like services.

## Rollback

1. In Vercel, open Deployments and promote the last verified production deployment.
2. Disable beta invitations and analysis traffic if data integrity is uncertain.
3. Do not reverse an applied database migration destructively. Apply a reviewed forward-fix migration or restore the Supabase project to a verified point-in-time backup.
4. Rotate any credential suspected of exposure and update Vercel Preview and Production environments.
5. Record the incident, affected window, rollback deployment ID, database action, and customer communication decision.
