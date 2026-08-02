# Decision Explainability

Trade Police presents decisions in this order:

1. Market and data state.
2. Deterministic verdict.
3. Plain-language headline.
4. Deterministic primary reason.
5. Required-rule count.
6. Next action.
7. Final risk check or retry action.
8. Full Decision Report.

The architecture remains: market evidence → saved trading rules → deterministic decision → explanation. The explanation layer translates existing output and never recalculates a verdict or readiness value.

## Verdict communication

- `READY`: every required rule that Trade Police can verify is confirmed. The next step is the final risk check.
- `WAIT`: required confirmation is still missing.
- `BLOCKED`: a required rule is violated or a forbidden condition exists.
- `NO_SETUP`: the saved setup is absent from current evidence.
- `MARKET_CLOSED`: explicit market-closure evidence prevents a current evaluation.
- `DATA_UNAVAILABLE`: trustworthy current data was not available, so no usable decision or readiness number is shown.
- `STRATEGY_INCOMPLETE`: a required rule is incomplete or unsupported.

## Primary-reason priority

Selection is deterministic:

1. Data or market state preventing evaluation.
2. Unsupported or incomplete required rule.
3. Blocking required rule.
4. Missing required rule.
5. Missing helpful confirmation.
6. General no-setup state.

Within a category, the saved runtime rule order is preserved; stable IDs are the final tie-breaker.

## Evidence states

- `CONFIRMED` — Confirmed.
- `MISSING` — Still needed.
- `BLOCKED` — Rule violated.
- `NOT_AVAILABLE` — Could not verify.
- `NOT_REQUIRED` — Not required.

Required rules are displayed before helpful confirmations. Rows retain the available observed value, expected value, source, timestamp, and deterministic reason. State is communicated with icon and text, never color alone.

## Readiness

Readiness summarizes evidence coverage; it is not a probability of profit. The customer surface leads with “X of Y required rules confirmed.” Existing percentages may remain as supporting detail only. Missing required rules continue to control the verdict and helpful confirmations cannot compensate for them. DATA_UNAVAILABLE and MARKET_CLOSED do not show a numeric readiness value.

## Next triggers

Next actions come from deterministic action or rule metadata. If that metadata cannot identify a truthful trigger, the product says: “Trade Police cannot determine the next trigger from the available rule definition.” The explanation layer never invents a price level, pattern, session, or event.

## AI boundary

The verdict, state labels, evidence, ordering, primary reason, next trigger, and data status are immutable deterministic context. AI can add separately labeled educational prose only. It cannot add or remove evidence, change priority, change a verdict, invent a trigger, recommend taking a trade, or provide a profit probability. Missing credentials, timeout, malformed output, or unsafe prose immediately use the deterministic fallback without delaying the verdict.

## Data provenance

The report shows provider, timeframe, last verified completed candle, and calculation time when available. Automatic rows are described as derived from completed market data; manual rows are marked as manual confirmations. The visible chart is contextual only: Trade Police does not use the chart image as the source of the verdict.

## Historical decisions and known limitations

Current saved records retain the original market-analysis JSON and strategy snapshot, but they do not store the final validation narrative and runtime evidence report together as a server-authoritative durable Decision Report. This sprint intentionally leaves persistence unchanged: the existing direct client write path cannot safely establish authoritative final-explanation fields through an additive column alone. History must not recompute an old result from current market data. A future server-owned save path should atomically store the final verdict, explanation snapshot, rule states, provenance, strategy revision, and AI prose separately under existing ownership/RLS controls.
