# Intelligence release closeout

Base: `c6e9f57` on `feature/trader-intelligence-adaptive-v2`. No new migration, provider migration, model change, credential change or production release is performed by this patch.

## Changes

- The intelligence footer formats its timestamp with the saved profile timezone.
- The existing Responses adapter now sends the same message/question/citation bounds as the local validator. Citation IDs are constrained to supplied top-level fact IDs, not nested execution IDs.
- Completed multi-part output text is concatenated correctly; incomplete and refused responses remain honest deterministic fallbacks.
- Format, unknown-evidence and safety failures receive separate non-sensitive diagnostic codes. Existing execution-command, guarantee and markup blocks are retained.
- Three stale UI source-contract tests now verify the current account navigation path, translated billing disclaimer plus webhook signature verification, and current onboarding copy. No runtime billing/risk behavior changed to satisfy them.

## Evidence

Fresh full suite: 2030/2030 pass. TypeScript, changed-file ESLint and production build pass. Tests cover strict schema bounds, allowed fact citations versus nested trade IDs, multi-part Responses content, malformed/incomplete/refused output, unsafe commands/markup, and timezone formatting.

The previous production OUTPUT_REJECTED record does not preserve its underlying rejection category. The schema/validator mismatch is reproducible, but the exact historical cause cannot be established from that generic record. This patch improves alignment and diagnostics; no successful live generated daily brief is claimed before deployment verification. Existing 24-hour daily generation claims are not cleared or bypassed for testing.

## Release gate

Publish the patch on the current branch, verify a new preview with a signed-in account, and perform one ordinary companion request using the app's configured provider. Confirm its recorded source is OPENAI, and confirm the saved timezone and footer agree. Do not silently relabel a fallback as AI. Then stage production for the exact tested source commit using the correct project/team and production environment; verify that build before assigning the production domain.

Direct GitHub content writes and Vercel deployment inspection remain permission-blocked in this session. A local commit or ZIP is not a remote push or deployment. Do not claim `tradepolice.app` updated until its production deployment and application response are verified.
