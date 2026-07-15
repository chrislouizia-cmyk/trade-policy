# Trade Police security foundation

Version 7 makes trade authorization server-side and loads the authenticated
user's active strategy from Supabase. The browser no longer supplies the
strategy used by the final verdict engine.

## Implemented

- Owner-only RLS remains enforced for strategies, rules, trades and active trades.
- Staff roles are separated from customer profiles.
- Support can retrieve account metadata only through an audited RPC.
- Staff RPC access requires an active role, an open ticket and MFA `aal2`.
- Technician access grants are customer-approved, scoped and time-limited.
- Administrative access logs are not readable by normal authenticated users.
- The proprietary verdict engine is located under `lib/server/` and marked
  `server-only`.
- The original three-instrument database constraint is removed so Strategy
  Builder instruments can be saved.

## Not yet claimed or implemented

- Encryption of strategy payloads with a production KMS.
- A staff/admin web interface.
- IP/device anomaly detection.
- External penetration testing.
- WAF/rate-limit configuration for production.

Do not claim zero-knowledge encryption until a production key-management design
has been implemented and independently reviewed.
