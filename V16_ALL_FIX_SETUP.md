# Trade Police V16 — All Fix Setup

This build fixes the HQ issues visible in the screenshots:

- Customer Directory returns existing customer profiles again.
- Customer 360 opens for a trader who also holds an internal Owner/staff role.
- Sales no longer displays static “available tools / protected data” boxes.
- Sales metric cards are clickable and reveal the people behind each count.
- Active subscriptions and trials are normalized even when older records use lowercase values.
- HQ employee invitations accept either the legacy service-role variable or Supabase's newer server secret variable.

## 1. Supabase SQL Editor

Run the complete file:

`supabase/migrations/014_operational_sales_and_customer_directory_fix.sql`

`No rows returned` is normal if no red SQL error appears.

## 2. Environment file

Create `.env.local` in the same folder as `package.json`.

Use either server-secret name shown below:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

or:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SECRET_KEY=YOUR_SUPABASE_SECRET_KEY
```

Never prefix the secret/service-role key with `NEXT_PUBLIC_`.

After changing `.env.local`, stop the server and start it again.

## 3. Clean install

```bash
rm -rf .next
npm install
npm run dev
```

## 4. Test

- `http://localhost:3000/hq/customers`
- Open the visible customer profile.
- `http://localhost:3000/hq/sales`
- Click Needs attention, Active subscriptions, Trial customers and Open leads.
- `http://localhost:3000/hq/team`
- Send a staff invitation.
