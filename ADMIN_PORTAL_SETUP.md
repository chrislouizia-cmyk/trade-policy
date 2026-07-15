# Trade Police Admin Portal

## Production domain

Use `admin.tradepolice.com` for the private company portal.

The included middleware routes the admin hostname automatically:

- `https://admin.tradepolice.com/` → private HQ Mission Control
- `https://admin.tradepolice.com/login` → private HQ sign-in
- `https://admin.tradepolice.com/team` → Team & permissions
- `https://admin.tradepolice.com/sales` → Sales workspace
- `https://admin.tradepolice.com/compliance` → Compliance workspace
- `https://admin.tradepolice.com/support` → Support workspace
- `https://admin.tradepolice.com/system` → System health

The client hostname `app.tradepolice.com` blocks HQ, admin and staff routes.

## Vercel domain steps

1. Open the Trade Police project in Vercel.
2. Go to Settings → Domains.
3. Add `admin.tradepolice.com`.
4. Add the DNS record Vercel provides at your domain registrar.
5. Add `app.tradepolice.com` later for the customer portal.

## Access model

- Staff use individual accounts.
- The Owner assigns roles and individual permission overrides.
- Every permission change is audited.
- Customer strategy content remains excluded from ordinary staff workspaces.
- No customer-facing link exposes the Admin Portal.

## Local testing

Use:

- `http://localhost:3000/hq/login`
- `http://localhost:3000/hq`

The custom hostname behavior activates after the domain is connected in Vercel.
