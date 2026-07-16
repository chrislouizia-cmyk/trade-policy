# Trade Police v15 setup

1. Run `supabase/migrations/013_customer_360_hq_staff_invitations.sql` in Supabase SQL Editor.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`. This key is server-only and must never be prefixed with `NEXT_PUBLIC_`.
3. In Supabase Authentication > URL Configuration, add your local and production callback URLs, including `http://localhost:3000/auth/callback`.
4. Run `npm install` and `npm run dev`.
5. Staff login: `http://localhost:3000/hq/login`.
6. Owner invitations: `http://localhost:3000/hq/team`.
