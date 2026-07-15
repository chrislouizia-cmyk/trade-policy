# Trade Police v9 — Complete Beta Experience

## Included
- Command-center dashboard
- Persistent account and strategy switchers
- Eight-step Strategy Builder with final review and local draft autosave
- Trading account edit, deposit, withdrawal, fee, manual adjustment and archive actions
- Today P&L, total return and drawdown
- Professional Close Trade modal with R, realized P&L and balance preview
- Analytics by strategy, instrument and session
- Authorized vs. Take Anyway performance
- Onboarding checklist
- In-app beta feedback form
- Clear loading/success messages and beta disclaimer

## Setup
1. Preserve `.env.local` from the prior version.
2. Run `supabase/migrations/008_beta_experience.sql` after migrations 001–007.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open `/` for the dashboard.

## Beta test sequence
1. Create two accounts and switch between them.
2. Create two strategies and switch from the header.
3. Analyze and take one trade.
4. Close it through the modal.
5. Confirm the ledger and dashboard balance update.
6. Open `/analytics`.
7. Send feedback using the floating Feedback button.
