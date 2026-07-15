# Trade Police Product Decision Log

## Product mission
Protect disciplined execution. No trade without evidence.

## v1.0 Founders Edition decisions

### Persistent active strategy switching
- Reason: users need to move between Forex, Gold, Futures, and Stock strategies without losing context.
- Rule: open trades retain the strategy snapshot used at entry.
- Status: Implemented.

### Trading accounts and auditable ledger
- Reason: every win, loss, fee, deposit, and withdrawal must explain the current balance.
- Status: Implemented.

### Daily limits per strategy and instrument
- Reason: each trader defines different limits for each symbol in each strategy.
- Status: Implemented.

### Green Day Protection
- Reason: prevent an extra trade from turning a profitable day negative.
- Status: Implemented.

### Clean customer errors and private operational logs
- Reason: clients should use the product without seeing provider limits, SQL errors, or internal architecture.
- Status: Implemented foundation.

### Trade Police Shield
- Reason: traders need an immediate READY, MONITORING, or SETUP REQUIRED status.
- Status: Implemented in v12.

### Broker automation deferred
- Reason: validate and sell the discipline product before adding assisted or automatic execution.
- Status: Planned after beta validation.
