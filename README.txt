TRADEPOLIS — ROLLING ANALYSIS CYCLE FIX

Replace these three files in your existing project, preserving the same paths:

1. lib/billing/period.ts
2. lib/billing/entitlements.ts
3. app/api/market/analyze/route.ts

Behavior after replacement:
- FREE keeps the 15-analysis limit defined in lib/billing/plans.ts.
- The monthly cycle starts on the date of the user's first analysis.
- It renews on the same calendar day each month.
- For dates such as the 29th, 30th, or 31st, shorter months use their final day.
- Failed analyses do not consume usage.
- The limit response includes periodStart and renewsAt.

No SQL migration is required because the existing analysis_usage table is reused.

After copying:
1. Save all files.
2. Run: npm run build
3. Run: npm run dev
4. Test with an account whose previous cycle has expired.
