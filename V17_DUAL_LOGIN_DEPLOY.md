# Trade Police V17 — Dual Login Deployment

## Portals

- Client login: `/client/login`
- Headquarters login: `/hq/login`
- Portal chooser: `/access`
- Legacy `/login` redirects to `/client/login`

## Behavior

- A customer account cannot enter Headquarters.
- An employee account cannot enter through the client login.
- Employee access is created by the Owner through HQ invitations.
- After employee login, Trade Police routes the email to its assigned workspace.

## Environment variables

Configure these locally and in Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5.4-mini
TWELVE_DATA_API_KEY=...
```

Never prefix the service-role key with `NEXT_PUBLIC_`.

## Supabase authentication URLs

In Supabase Authentication → URL Configuration, add your production URLs, for example:

- `https://YOUR_DOMAIN.com/auth/callback`
- `https://YOUR_VERCEL_DOMAIN.vercel.app/auth/callback`

Set the Site URL to your production domain.

## Local test

```bash
npm install
rm -rf .next
npm run dev
```

Test:

- `http://localhost:3000/access`
- `http://localhost:3000/client/login`
- `http://localhost:3000/hq/login`

## Deploy

Push this version to GitHub. In Vercel, import or redeploy the repository, add all environment variables, then deploy.
