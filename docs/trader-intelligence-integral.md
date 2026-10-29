# Trade Police · Intelligence V4

## Implemented

- Automatic personal state built from recorded executions, decisions, saved preferences/corrections, market scans and intervention responses.
- Gross recorded R is replaced with net realized P&L / recorded risk when both are documented. Fees are never subtracted twice. Coverage remains explicit.
- Instrument/strategy/hour combinations with separate discovery and later validation, plus performance drift against a preceding sample.
- Observable risk escalation after a known loss and late-session entry patterns. No emotion or intent diagnosis.
- Per-account drawdown and recorded open-position risk, same-direction concentration and stale/unknown quote warnings. Currency balances are not combined.
- Recorded market bias/ATR, scoped to the scan's instrument, strategy, timeframe and timestamps. Invalid/latest unavailable scans do not inherit older conclusions.
- Automatic execution reviews, rolling weekly summary and one training priority with descriptive adherence progress.
- A daily LLM brief using the existing provider adapter and cited facts. Atomic per-user/day claims and a rolling 24-hour cooldown prevent duplicate generation and timezone-change budget bypasses. Provider failures remain deterministic fallbacks, without pretending to be AI.
- A private refresh queue coalesces source changes. Leases, versioned completion and retries preserve changes that arrive during processing. Source mutations, page activity and the existing daily cron drive processing.
- Explicit preference/correction/note memory management, evidence inspection, helpful/not-helpful responses and optional muted observations.
- Opt-in aggregate contributions. Strategy data, notes and identities do not enter published patterns. Thresholds are 20 contributors and 100 trades; hour/day buckets include timezone. Matched aggregate findings are hypotheses, not a personal advantage.
- Retrospective hypothesis comparisons and explicit prospective shadow studies. Studies freeze the hypothesis, start time, timezone and baseline evidence; only later entries/outcomes are evaluated. Finished studies retain their saved evaluation. No orders or strategy edits occur.
- Minimal interface: compact priority observation on the dashboard; evidence and control disclosures inside Analytics → Police Intelligence. Existing chat stays optional and receives the integral facts.

## Boundaries

This is an evidence/context learning system, not online training of model weights. The constitutional decision engine remains authoritative. Existing loss/risk rules are unchanged. Brokerage order execution, cross-market measured correlations, live news/spreads and causal proof of intervention benefit are unavailable. Those require additional integration and evaluation.

Retrieval covers the 300 latest closed executions, 100 open positions/accounts, 500 decisions, 30 memories, 100 responses, 12 scans and 10 studies. It does not claim complete lifetime coverage. A saved preference is trader-stated, never an authorization rule.

Unattended refresh uses the existing daily cron and its CRON_SECRET. Active pages schedule a user queue refresh at most every five minutes; material server events also schedule work after the response. A worker has a bounded execution budget. Larger inactive cohorts need a higher-frequency worker schedule before claiming a daily refresh for every account at scale.

## Validation

- TypeScript and ESLint on changed components/modules.
- 91 selected intelligence/UI/navigation tests.
- PostgreSQL-in-WASM isolated fixture: migration, RLS, grants, denied cross-user access and writes, duplicate claims, retry behavior, source changes during work and daily generation claims.
- Full suite: 2018/2021 passed; the same three pre-existing failures remain (account discoverability assertion, billing copy assertion, onboarding copy assertion).
- Production build checked for the final patch.

No authenticated browser-to-database verification has occurred for V4. After explicit user approval, the migration was applied on 2026-10-08 to production as version 20261008225747. Live checks confirmed three RLS tables, restricted queue/RPC access, ten triggers, eighteen seeded pending profiles, and a service-role claim/completion inside a rolled-back transaction. V4 code deployment and authenticated runtime verification remain pending.

## Activation order

1. Already approved and applied: additive migration `20261008225747_trader_intelligence_integral.sql`.
2. Completed: live access/queue checks and advisors. Queue RLS without client policies is intentional; the new history index is unused before application deployment.
3. Apply the code patch over the UI Repair release. The installer validates and commits code; it never applies SQL, pushes or deploys.
4. Push the feature branch and deploy Trade Police through the existing production project.
5. Verify with a real signed-in test account: evidence isolation, memory CRUD, queue completion, one daily brief, feedback, opt-in/out and a prospective study.

The isolated SQL verifier accepts an explicit PGlite module path as its first argument. PGlite is a test-only dependency, not added to the production application.
