# Trade Police V19 — Beta Release Setup

## Included
- Client-facing release notes no longer expose Headquarters or staff controls.
- Mobile Strategy Builder uses a compact step indicator and a safe bottom action bar.
- Strategy instruments come from each saved strategy and the full Forex/metals catalog is available in Strategy Builder.
- Analytics includes an equity curve, best/worst trade, P&L by hour, weekday, strategy, instrument and session.
- Sales includes every registered customer, email, beta status, Free/Pro/Premium plan filters and follow-up actions.
- System includes critical incidents, failed actions, analyses today, top instruments, top customers and incident resolution.
- Customers uses a searchable, paginated, collapsible directory.
- Organizations is now Company and explains company health and integrations.
- Password recovery now lands on a real Create New Password page and reports expired links.

## Supabase
Run `supabase/migrations/016_beta_release_operations_mobile_analytics.sql` once in SQL Editor.

In Authentication > URL Configuration use:
- Site URL: your production Vercel URL
- Redirect URLs: `https://YOUR-DOMAIN/**` and `http://localhost:3000/**`

## Local test
Copy `.env.local`, then:

```bash
npm install
rm -rf .next
npm run dev
```

## Vercel environment variables
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- OPENAI_API_KEY
- OPENAI_VISION_MODEL
- TWELVE_DATA_API_KEY
