# Trader Companion

Trade Police now has a conversational companion alongside the deterministic engine. Its collapsible panel remains available above the mobile navigation. It explains saved decisions, asks for missing details, discusses open positions and completed backtests, and proposes process improvements for trader review. It cannot place orders, authorize trades or edit a strategy.

## Personal learning

- Explicit memories are saved only when the trader checks “Remember this”. Saved memories can be inspected and deleted. Deleting a saved memory does not erase the conversation transcript.
- Closed recorded executions produce descriptive observations by instrument, session and strategy, plus recorded overrides of the original verdict. Every observation carries its source trade IDs. Simulations, incomplete records and other traders' data are excluded. This is retrieval and evidence-based personalization, not automatic model-weight training.
- Contextual analysis feedback becomes correction evidence in subsequent conversations. It is a trader statement, not a verified market fact or automatic engine update.
- The retrieval window is 300 closed records, 30 saved memories and 20 feedback entries. Smaller samples cannot establish an edge; backtests are kept separate from actual recorded executions.
- Closing a trade refreshes the learning snapshot. The context endpoint also recomputes it, so a failed refresh does not lose the closed execution.

## Conversation and context

The root client companion restores a per-user conversation. Analysis, deterministic decision, instrument/timeframe change, active position, close and backtest report events update its context. Automatic commentary can be disabled. Speech playback is optional and requires a click.

Strategy drafting now reads and writes `strategy_copilot_sessions` instead of the process-local Map, includes prior conversation and trader facts, and restores the latest draft for the matching CREATE/EDIT context. Proposed strategies still require the existing canonical review and confirmation flow.

## Persistence and access

Migration `20261005050853_trader_learning_companion.sql` adds owner-scoped RLS tables for memories, learning snapshots, conversations and provider provenance. The companion persistence RPC commits a turn, optional memory and audit together, using an expected version to reject stale writes. Only the server service role can invoke it or write these tables. The existing strategy-drafting table remains protected by its owner policy.

All context IDs are checked against the authenticated owner. The API rejects cross-origin mutations, bounds input/output, validates supplied citations and rejects common execution commands and guarantees. These checks do not prove that every AI sentence is correct; the deterministic decision remains authoritative. Provider failure is explicitly labeled as fallback and does not fabricate an AI interpretation.

## Runtime and verification

Uses the existing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (or existing secret-key alternative), `OPENAI_API_KEY` and `OPENAI_MODEL`/`OPENAI_VISION_MODEL` configuration. No new provider or key is required.

Run `npm run typecheck`, `npm run lint`, `npm run build` and `npm test`. Focused tests cover simulated-record exclusion, ownership, descriptive samples, citation validation, provider payloads and fallbacks. The database transaction test verifies actual RLS, atomic persistence and stale-write rejection with rolled-back fixtures.

For an actual OpenAI/HTTP smoke test in an environment that exposes the runtime keys, run:

```sh
node --env-file=.env.local scripts/verify-trader-companion.mjs
```

It creates two disposable QA accounts and removes them in `finally`. It verifies actual AI generation, persistence, isolation, origin protection, memory deletion and clarification. Do not count this test as passed unless it prints `passed: true`.

Local validation for this change: production build and TypeScript pass; 1981 of 1984 unit tests pass. The three failures also fail on the original deployed commit and concern existing navigation, billing copy and onboarding copy. Live RLS/persistence assertions passed. The compiled HTTP check also passed (home 200, unauthenticated reads/writes 401, unrelated origin 403). The proxy lets this endpoint return JSON while its handlers enforce mandatory authentication. The real-provider smoke test and browser check remain pending because sensitive runtime keys are unavailable to this workspace and the browser blocks its local server.
