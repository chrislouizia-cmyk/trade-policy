# Private Beta Operational Retention and Observability

## Cleanup scheduling

Migration `043_private_beta_operational_observability.sql` adds the idempotent `cleanup_expired_decision_report_sources` function. It selects only expired, unsaved source tokens (`expires_at <= now()`) and never touches `decision_reports` or AI explanations. Every run stores only dry-run, expired, deleted, and run-time counts.

Vercel Cron calls `GET /api/operations/decision-sources/cleanup` daily at 03:17 UTC. Set `CRON_SECRET` as a server-only Vercel environment variable; Vercel supplies it as `Authorization: Bearer <CRON_SECRET>`. The route uses constant-time comparison and fails closed if configuration is absent. Never prefix the secret with `NEXT_PUBLIC_`.

Before enabling deletion, call the endpoint manually with `?dryRun=true` and the same authorization header. Dry-run records counts but deletes nothing. Repeated real runs are safe and return zero deletions after the backlog is cleared.

## Operational monitoring

`GET /api/hq/health` remains authenticated and requires `system.health`. Its `privateBeta` section reports only `HEALTHY`, `DEGRADED`, or `UNAVAILABLE` for Supabase, Twelve Data, billing configuration, historical-report persistence, cleanup backlog, and recent sanitized incident counts. It never returns environment values or raw errors.

`GET /api/hq/historical-reports/audit` uses the same HQ permission and performs a dry-run schema inventory. It returns counts by schema version, the supported-version registry, and `migratedCount: 0`; it never rewrites reports.

## Decision Report incident codes

- `AUTHENTICATION_FAILED`: save attempted without a valid session; not retryable until sign-in.
- `SOURCE_EXPIRED`: the short-lived authoritative source exceeded 24 hours; rerun the final check.
- `SOURCE_NOT_FOUND`: no owned source reference exists.
- `STRATEGY_REVISION_MISMATCH`: trading rules changed after the market scan.
- `FINGERPRINT_FAILURE`: the validated snapshot or canonical fingerprint could not be prepared.
- `DATABASE_UNAVAILABLE`: persistence was temporarily unavailable and is retryable.
- `IDEMPOTENCY_CONFLICT`: one request key was reused for a different decision.
- `UNKNOWN_SAFE_ERROR`: an unclassified failure represented without raw error content.

Failure rows contain only the reason code, request ID, optional operationally necessary user ID and source-analysis ID, retryability, and timestamp. They never contain evidence, report JSON, AI prompts, provider payloads, payment details, secrets, or raw exception messages.

## Schema-version policy

`HISTORICAL_REPORT_SCHEMA_REGISTRY` is the sole supported-version registry. Version `1.0.0` is currently supported. Unknown versions remain stored and render the existing customer-safe unsupported state. Sprint 4A audits counts only and performs no migrations.

## Privacy-safe beta metrics

The existing first-party `beta_intelligence_events` store records these lifecycle events without evidence or payment metadata: signup completed, onboarding completed, strategy saved, first analysis completed, Decision Report opened, Decision Report saved, saved report reopened, upgrade initiated, and verified Checkout completed. Server-owned events are emitted after authoritative operations; client events contain only the allowlisted event type, optional owned strategy ID, app version, coarse platform, and anonymous session ID.

## Rollback

Disable the Vercel Cron before removing the cleanup route. The migration is additive except for replacing the report-save RPC with stricter idempotency-conflict behavior and extending the existing event allowlist. Retain failure and cleanup-run rows for operational review; dropping them is not required to stop collection.
