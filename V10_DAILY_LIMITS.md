# Trade Police v10 — Daily Instrument Limits & Green Day Protection

This release adds:

- Maximum daily trades per strategy.
- Maximum daily trades per selected instrument.
- Server-calculated daily counts based on executed trades.
- Green Day Protection after the regular limit.
- Configurable protected floor, extra-trade count, and reduced risk.
- Hard blocking of Take Anyway when a daily risk limit is reached.
- Immediate refresh of Validation Desk after saving the active strategy.
- Newly added strategy instruments loaded from `strategy_instruments` with no API cache.

Run `supabase/migrations/009_daily_trade_limits_and_green_day.sql` after the previous migrations.
