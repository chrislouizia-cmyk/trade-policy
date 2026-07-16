# Trade Police V18 — Feedback Tickets + Real Strategy Enforcement

## What changed

### Beta feedback becomes operational tickets
- Every beta tester report now creates a ticket with title, type, priority, page, ease score and customer identity.
- HQ Support (`/hq/support`) is now a working queue.
- Staff can filter, prioritize, assign, document and resolve feedback.

### Strategy switching is enforced server-side
- The client can no longer choose which strategy the AI or live-market endpoint applies.
- `/api/analyze`, `/api/market/analyze`, and `/api/validate` load the active strategy directly from Supabase for the authenticated user.
- Switching strategies clears stale analysis and reloads the full selected strategy.
- AI reasoning receives the selected strategy's timeframes, instruments, RR, risk, enabled rules, mandatory evidence, preferred setups, news controls and thresholds.

## SQL
Run this file in Supabase SQL Editor:

`supabase/migrations/015_beta_feedback_tickets_and_strategy_enforcement.sql`

`No rows returned` is normal if no red error appears.

## Run

```bash
npm install
rm -rf .next
npm run dev
```

## Test
1. Customer portal: switch between two substantially different strategies.
2. Open Validate and confirm the displayed instruments, timeframes, risk and sessions change.
3. Run chart or live analysis and confirm the response is based on the newly active strategy.
4. Submit a Feedback ticket from the customer portal.
5. Open `/hq/support`, assign it, change priority, add a resolution note and resolve it.
