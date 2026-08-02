# Historical Decision Reports

Historical Decision Reports are immutable, server-owned snapshots of completed decisions. Schema `1.0.0` stores only the customer-facing deterministic explanation, evidence states, final risk check, strategy identity, and market provenance needed to explain the original result.

## Ownership and save path

`/api/market/analyze` creates `market_scans` with the server-only Supabase client. `/api/validate` resolves that owned scan and active strategy, replaces browser-submitted automatic evidence with the stored analysis, runs the existing deterministic engine unchanged, validates the snapshot, and stores a short-lived source for 24 hours. `POST /api/decisions/save-report` accepts only the source reference and an idempotency key. A service-role-only database function promotes the source atomically.

Authenticated users have select-only access to their own reports and AI explanations. They have no insert, update, or delete permission. Immutable triggers reject updates, while account deletion can still cascade under the existing account policy. Market scans are select-only to browsers.

## Fingerprint and idempotency

The SHA-256 fingerprint uses canonical key ordering and deterministic report content. It excludes the random report ID, user ID, client state, and AI prose. Unique constraints on source analysis plus fingerprint and on user plus idempotency key prevent sequential and concurrent duplicates. A duplicate request returns the existing stable report URL.

## AI separation and reopen behavior

Optional AI educational prose is stored in `decision_report_ai_explanations`, references the deterministic fingerprint and source verdict, and has `authoritative=false`. AI failure does not block snapshot creation. Reopening `/history/[reportId]` reads the saved JSON only: it does not call a market provider, reload Strategy DNA, run the decision engine, recalculate readiness, or regenerate prose.

## Data minimization and retention

Reports do not store provider payloads, screenshots, AI prompts, secrets, billing data, HQ objects, or detector internals. Short-lived unsaved sources expire after 24 hours and may be removed by a future maintenance job. Saved reports currently have no customer delete operation and remain until account deletion or a documented retention policy is introduced.

## Migration and rollback

Migration `042_historical_decision_reports.sql` is additive except that it removes browser write access to `market_scans`; the existing server analysis route uses service-role writes. Existing `trade_records` are preserved and are not backfilled because they lack complete server-authoritative decision state.

## Known limitations

Only reports produced after migration 042 can be saved authoritatively. The archive shows up to the 50 most recent matching reports. Unknown schema versions fail closed with a customer-safe message and an internal report/version log.
