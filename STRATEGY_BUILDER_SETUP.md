# Trade Police Strategy Builder — Phase 1

## Included
- Multiple strategy profiles per user
- Create, edit, duplicate, activate, and archive profiles
- Searchable Forex and metals instrument catalog
- Custom symbols
- Macro, trend, confirmation, entry, and trigger timeframes
- Preset and custom trading sessions with timezone and hours
- Risk limits, RR thresholds, and authorization scores
- Optional and mandatory rules with weights, confidence, and timeframe role
- Per-instrument stop method and maximum
- Preferred setup selection
- News protection controls
- Compatibility with the existing Validation Desk through the active strategy

## Installation
1. Open Supabase > SQL Editor > New query.
2. Paste and run `supabase/migrations/004_strategy_builder.sql`.
3. Replace the local project with this folder, but preserve your own `.env.local`.
4. Run:
   ```bash
   npm install
   npm run dev
   ```
5. Open `/profile` and save a strategy.
6. Set one profile as Active and return to `/validate`.

## Phase boundaries
This release includes the complete Phase 1 foundation and Forex catalog. Dynamic stocks, futures contract rollover, trailing exits, economic-calendar integration, and multi-instrument scanning remain Phase 2 and 3 work.

## Security
The new configuration tables use Row Level Security and restrict rows by `user_id`. Do not place service-role, OpenAI, Twelve Data, or other private keys in any `NEXT_PUBLIC_` variable.
