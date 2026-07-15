# Trade Police v8 Beta Foundation

## Included

- Trading accounts with initial and current balance.
- Auditable account ledger.
- Atomic balance update when an active trade closes.
- Account selection in Validation Desk.
- Risk amount and balance snapshots stored at entry.
- Strategy snapshot and strategy name stored with each active trade.
- Persistent active-strategy switcher in the application header.
- Guided seven-step Strategy Builder.
- Accounts dashboard at `/accounts`.

## Required migration

Run `supabase/migrations/007_trading_accounts_and_ledger.sql` after migrations 001–006.

## Test flow

1. Open `/accounts` and create a paper or demo account.
2. Set it active.
3. Select an active strategy from the header.
4. Open `/validate`, analyze and record a trade.
5. Open `/active-trade` and close it with an exit price and fees.
6. Return to `/accounts` and confirm the balance and ledger changed once.
