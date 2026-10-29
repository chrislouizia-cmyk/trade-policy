# Per-user trading timezone

The first device initializes an UNSET intelligence profile. The atomic update is scoped by authenticated user ID and `timezone_source = UNSET`. Later device reports never replace DEVICE or USER selections; a concurrent manual choice wins over stale initialization attempts. Existing recorded zones are retained by the migration.

An authenticated owner can explicitly change the timezone in Analytics → Personal intelligence → Trading timezone. The API validates/canonicalizes the IANA name, records USER as the source, enqueues recomputation and schedules the existing worker. It does not change trading rules, account balances, entitlements or stored UTC trade timestamps.

Each user’s learning summary already uses their saved timezone for local hour/weekday analysis. IANA daylight-saving rules apply automatically. Personal-intelligence timestamps now render in that same zone rather than the browser’s zone. A traveller can choose another IANA zone or explicitly use the current device’s zone; travel detection does not silently move their trading reference.

Migration `20261029072012_trader_timezone_preference.sql` was applied to TP on 2026-10-29. It adds only the timezone-source field and classifies existing profile zones. Do not apply it again. App installation/deployment is required before the new tracker policy takes effect; old deployments still report their device zone on every page view.

Verification: 40 timezone/learning/intelligence tests pass; TypeScript, changed-file ESLint and production build pass; isolated PostgreSQL verifies legacy preservation, conditional initialization, stale-device exclusion, explicit choices and per-user isolation. Full suite: 2022/2025 pass, retaining the same three existing account-link/billing-copy/onboarding-copy assertion failures. The new UI/API flow has not been verified in a deployed preview yet. The earlier daily-brief OUTPUT_REJECTED issue remains separate and unresolved.
