# Trade Police v2.3 — Supabase Multi-user Foundation

Private, trainable, rule-based trading assistant for XAUUSD, GBPUSD and GBPJPY.

## Included
- Email/password account creation and login with Supabase Auth.
- Protected `/validate` page and protected AI endpoints.
- H4, H1 and M30 chart upload.
- AI-assisted checklist with editable confirmations.
- Deterministic score, vetoes and AUTHORIZED / WAIT / REJECTED verdict.
- Up to three probable setup candidates.
- Persistent suggested and executed trades in Supabase.
- Private Storage uploads for H4, H1, M30 and mandatory post-trade screenshots.
- Post-trade analysis and five-loss Investigation Mode.
- Profiles include plan and subscription status fields for a later SaaS launch; billing is intentionally not enabled yet.

## 1. Create the Supabase project
Create a project, open the SQL Editor and run:

`supabase/migrations/001_trade_police.sql`

The migration creates profiles, trade records, investigation reviews, RLS policies and the private `trade-charts` bucket.

## 2. Authentication settings
In Supabase Authentication:
- Enable Email provider.
- Choose whether email confirmation is required.
- Add `http://localhost:3000/auth/callback` as a redirect URL for local development.
- Add the production Vercel callback URL later.

## 3. Environment
```bash
cp .env.example .env.local
```
Fill in the Supabase URL, publishable/anon key and OpenAI API key. Never expose the Supabase secret/service-role key in the browser.

## 4. Run
```bash
npm install
npm run dev
```
Open `http://localhost:3000`; unauthenticated users are redirected to `/login`.

## Security model
- Every database record has a required `user_id`.
- RLS uses `auth.uid()` so users can only access their own rows.
- Chart files are stored in a private bucket under `{user_id}/...`.
- AI endpoints require an authenticated session.
- The AI proposes evidence; fixed code issues the final verdict.

## Before charging subscriptions
Add verified billing webhooks, server-enforced entitlements, usage quotas, abuse/rate controls, legal disclosures, privacy/retention controls, audit logs, monitoring, backups and security testing. Do not rely on hidden UI buttons to enforce paid access.

## v3 Strategy Profiles
Run `supabase/migrations/002_strategy_profiles.sql` after the original migration. Then visit `/profile` to configure instruments, timeframes, required evidence, weights, RR, risk, sessions, stop limits, authorization thresholds, and loss-streak investigation threshold. The Validation Desk loads the active default profile and stores a rule snapshot with each executed trade.

## Trade Police v4 — Live Market Data

This version adds a screenshot-free live-data mode. The embedded TradingView chart is visual context; Trade Police performs its calculations from OHLC candles supplied by Twelve Data.

### Additional environment variable

```env
TWELVE_DATA_API_KEY=your_twelve_data_api_key
```

Create a Twelve Data API key, add it to `.env.local`, and restart `npm run dev`.

### Additional Supabase migration

Run `supabase/migrations/003_live_market.sql` in the Supabase SQL Editor. It creates a private `market_scans` table protected by RLS.

### Live analysis flow

1. The user selects an instrument.
2. Trade Police downloads candles for the strategy profile's trend, confirmation, and entry timeframes.
3. The deterministic OHLC engine estimates bias, swing breaks, liquidity sweeps, three-candle imbalances, and retests.
4. The existing editable checklist is filled automatically.
5. The existing deterministic police engine issues the final authorization after entry, stop, and target are selected.

The screenshot workflow remains available as a second opinion and visual fallback.

## Active Trade Monitor

Run `supabase/migrations/005_active_trade_monitor.sql` after migration 004. The Validation Desk then exposes **Trade taken** for authorized trades and **Take anyway** for WAIT/REJECTED trades. Both actions open `/active-trade`, where the user can refresh the price, re-analyze the original thesis, review MFE/MAE/current R, and close the trade.

The authenticated pages display `Hi, {display_name}` using `profiles.display_name`, then Auth metadata, then the email prefix as a fallback.

## Version 7 security and authorization fix

Run `supabase/migrations/006_security_and_staff_access.sql` after migrations 004
and 005. Final trade authorization now loads the active strategy on the server
and no longer trusts a strategy object sent by the browser.
