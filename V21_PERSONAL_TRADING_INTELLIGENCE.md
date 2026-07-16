# Trade Police V21 — Personal Trading Intelligence

## Product promise

**Trade Police does not teach you how to trade. Trade Police learns how you trade.**

Every recommendation is evaluated according to the trader's active methodology, personal rules and global risk controls—not a generic framework.

## Included in this release

- Profile Completion V2 for new and existing users.
- Strategy Builder methodology library covering Market Structure, Liquidity, Supply & Demand, ICT / Smart Money, Wyckoff, Trend Following, Breakout, Mean Reversion and Volume.
- Personal time and execution rules.
- Trading style and minimum intended holding time.
- AI Behavior profile: tone, strictness, confidence threshold, explanations and compliant alternatives.
- Minimum / preferred / maximum stop ranges per instrument.
- Server-loaded strategy behavior included in chart-analysis prompts.
- Deterministic rejection of stops below the configured minimum or above the maximum.
- Dynamic instrument validation instead of a fixed three-symbol analysis schema.
- Password recovery now sends users directly to `/reset-password`, which exchanges PKCE recovery codes itself.

## Database setup

Run this migration in Supabase SQL Editor:

`supabase/migrations/017_v21_personal_trading_intelligence.sql`

## Environment

Copy your existing `.env.local` into the project locally. Do not upload it to GitHub. Ensure the same variables exist in Vercel.

## Local verification

```bash
npm install
rm -rf .next
npm run build
npm run dev
```

Test:

- `/complete-profile`
- `/profile`
- `/validate`
- `/forgot-password`
- `/reset-password`
- `/client/login`
- `/hq/login`

## Supabase redirect URLs

- `https://trade-police.vercel.app/reset-password`
- `https://trade-police.vercel.app/auth/callback`
- `https://trade-police.vercel.app/**`
- `http://localhost:3000/**`
