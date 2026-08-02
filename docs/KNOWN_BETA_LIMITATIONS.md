# Known Private Beta Limitations

- Stripe Checkout, verified webhooks, and the Customer Portal are implemented but require migrations 039 and 041, an account-verified $29 USD monthly Test Price, Portal and webhook configuration, and an end-to-end Test Mode Vercel Preview checkout before activation. Live Mode remains disabled.
- Onboarding captures identity, experience, and trading style, then guides the customer to Strategy DNA. Instrument and risk preferences live in the Strategy Builder rather than a separate onboarding wizard.
- Decision history is a minimal read-only view of saved trade records. Dedicated permalink reports, outcome editing, and rich journal notes are not yet available.
- Market availability depends on the configured Twelve Data plan, quotas, supported symbols, and candle freshness. The product must be treated as unavailable when current data cannot be verified.
- Some Strategy DNA rules require manual or external confirmation. Unsupported mandatory rules remain pending/blocking and cannot produce READY.
- AI explanation is optional and may be unavailable. It cannot alter deterministic status, authorization, mandatory rules, or risk limits.
- No broker connection, order execution, portfolio optimization, strategy marketplace, social features, public backtesting, Monte Carlo UI, or automatic trading is included.
- Financial analytics require real closed-trade outcomes. The beta must not infer or invent win rate, P&L, profit factor, or equity when those records do not exist.
- Legal disclosures in the product are a launch draft and require counsel review before paid availability.
- Research, historical datasets, validation runners, experiment artifacts, and engine audit tools remain internal HQ intellectual property.
