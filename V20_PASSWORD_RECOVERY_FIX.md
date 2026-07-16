# Trade Police V20 — Password recovery hotfix

This release fixes the customer password-reset flow.

## Supabase URL configuration

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: `https://trade-police.vercel.app`
- Redirect URLs:
  - `https://trade-police.vercel.app/auth/callback`
  - `https://trade-police.vercel.app/reset-password`
  - `https://trade-police.vercel.app/**`
  - `http://localhost:3000/**`

Use the exact production domain currently connected to Vercel. Add custom domains too when introduced.

## No SQL migration

This hotfix does not require SQL.

## Test

1. Open `/forgot-password`.
2. Request a recovery email.
3. Open the newest email.
4. The link must reach `/reset-password` and show two password fields.
5. Save a password of at least eight characters.
6. Sign in through `/client/login` with the new password.
