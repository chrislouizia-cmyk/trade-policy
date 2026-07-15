# Trade Police v11 — Production Control + UX Polish

## Included
- Unified navigation and persistent active account/strategy context.
- Cleaner hierarchy, buttons, forms, cards, mobile behavior and modals across the app.
- Customer-safe API messages that do not expose provider quotas, keys, tables, stack traces or internal services.
- Private operational telemetry tables and audited RPCs.
- Owner-only `/admin` dashboard with customer counts, plans, activity, feedback and system incidents.
- The admin dashboard intentionally does not expose customer strategy rules, screenshots or trade details.

## Required migration
Run `supabase/migrations/010_production_control_and_admin.sql` after migration 009.

## Make yourself owner
After running migration 010, execute this once in Supabase SQL Editor, replacing the email:

```sql
insert into public.staff_roles(user_id, role, is_active)
select id, 'OWNER', true from auth.users where email = 'YOUR_EMAIL_HERE'
on conflict (user_id) do update set role='OWNER', is_active=true, updated_at=now();
```

Then sign out and sign back in. Open `/admin`.
