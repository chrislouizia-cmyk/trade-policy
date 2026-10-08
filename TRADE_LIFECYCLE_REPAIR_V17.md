# Trade Lifecycle Repair — v17

## Corrected in this package

- `READY` decisions expose **Take Trade**.
- Executable `WAIT` and overridable `BLOCKED` decisions expose **Take Anyway** before the override reason is entered.
- Hard non-overridable risk controls remain blocked.
- The override modal requires both an explanation and explicit acknowledgement.
- Trade activation links to the immutable decision source.
- A temporary decision-source UUID is no longer incorrectly sent as a saved Decision Report UUID. That mismatch previously caused `/api/trades/take` to reject otherwise valid activations.
- Successful activation creates an `active_trades` record and redirects to `/active-trade`.
- Added focused UI activation tests for READY, WAIT override, and unavailable data.

## Required database migration

Confirm that `supabase/migrations/045_trade_activation_source_links.sql` has been executed in Supabase before deploying this package.

## Verification performed

Focused trade lifecycle and activation UI tests: 22 passed, 0 failed.

A full Next.js production build could not be completed in the repair environment because Next.js attempted to download its Linux SWC binary from an unavailable package mirror. This was an environment dependency-download limitation, not a TypeScript error reported by the project.
