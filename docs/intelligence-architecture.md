# Trade Police Intelligence architecture

## Decision authority

The deterministic Sprint A Decision Engine is the sole authority for trading decisions. It owns evidence evaluation, automatic/manual rule separation, risk calculations, strategy thresholds, vetoes, daily controls, and the final `AUTHORIZED`, `WAIT`, or `REJECTED` verdict.

The Intelligence layer runs only after that verdict exists. It cannot feed information back into the engine or change the engine input or output.

```text
validated request + active strategy + daily context
                       |
                       v
          deterministic Decision Engine
                       |
          AUTHORIZED / WAIT / REJECTED
                       |
                       v
      deterministic Decision Narrative builder
                       |
          immutable operational narrative
                       |
                       v
       optional coaching-only AI enhancement
                       |
                       v
        additive decisionNarrative response
```

The public mapping is exact and must not be inferred by AI:

| Engine verdict | Narrative recommendation |
| --- | --- |
| `AUTHORIZED` | `ENTER` |
| `WAIT` | `WAIT` |
| `REJECTED` | `BLOCK` |

`ENTER` means that configured deterministic conditions passed. It is not a promise or probability of profit.

## Post-validation flow

`POST /api/validate` authenticates the user, validates its request, loads the active strategy and daily context, rejects confirmations for rules that are not configured as manual, applies valid manual confirmations, and executes the deterministic engine.

After the final `TradeResult` exists, the route builds a deterministic `DecisionNarrative`. That narrative is the operational read model returned to consumers. An optional server-side coaching call may then attach educational fields. AI failure never removes the deterministic narrative.

The existing validation response remains intact. `decisionNarrative` is an additive sibling of the existing result, strategy reference, and manual confirmations.

## Deterministic narrative ownership

The deterministic layer exclusively owns:

- `recommendation` and `engineVerdict`;
- headline and operational explanation;
- reason identities, statuses, blocking flags, categories, and messages;
- missing-evidence identities, modes, wording, and confirmability;
- next-action identities, types, labels, rationales, ordering, and blocking flags;
- strategy context and risk-policy summary;
- evidence-readiness values and wording;
- discipline message;
- narrative timestamp and contract version.

The AI layer receives these fields only as immutable, read-only context.

## Coaching-only AI contract

AI may return only:

- `educationalExplanation`;
- `coachingMessage`;
- `learningTip`.

These fields are optional. Their absence must not affect the verdict, narrative, or usability of validation.

AI can never modify or replace:

- verdict or recommendation;
- headline or deterministic explanation;
- reason or evidence wording;
- reason status or blocking state;
- missing evidence or evaluation mode;
- manual-confirmation state;
- next-action type, label, rationale, or priority;
- readiness score or strategy threshold;
- strategy or risk constraints.

The server accepts coaching only when it matches the strict three-field JSON schema and passes semantic-safety checks. Any extra property, operational instruction, verdict language, evidence interpretation, readiness claim, profit claim, markup, or unknown vocabulary causes deterministic fallback.

## Automatic and manual evidence

`evaluation_mode` remains a strategy and engine concern.

- Automatic evidence is determined by the analysis/engine path and is never user-confirmable in the narrative.
- Manual evidence is confirmable only when an enabled strategy rule is explicitly configured as `MANUAL`.
- Manual rules are never described as automatically detected unless the authoritative engine reports that state.
- The narrative does not convert automatic evidence to manual evidence or vice versa.
- Unknown per-rule detector confidence remains `null`; it is never invented.

## Failure and fallback behavior

The deterministic narrative is constructed synchronously after successful validation. AI coaching is attempted only after that narrative exists.

If the OpenAI key is absent, the request times out, the request fails, parsing fails, schema validation fails, or semantic-safety validation fails:

- the complete deterministic narrative is returned;
- `source` remains `DETERMINISTIC`;
- `fallbackUsed` is `true`;
- coaching-only fields remain absent;
- the validation verdict and existing response fields are unchanged.

An unexpected deterministic-builder exception currently prevents the request from being a successful validation response. It cannot produce a successful response that silently omits `decisionNarrative`.

## Rendering safety

Every narrative and coaching field must be rendered as plain text. React text interpolation is the expected rendering mechanism.

AI content must never be passed to `dangerouslySetInnerHTML`, interpreted as trusted HTML, or rendered through a markdown configuration that permits embedded HTML. Model output is untrusted text even after schema and semantic validation. Treating it as HTML would create an avoidable cross-site-scripting boundary and would incorrectly elevate coaching text to trusted application content.

## Release 2 consumption

Release 2 may consume `decisionNarrative` directly as a read model:

- the recommendation and headline provide the primary deterministic state;
- reasons and missing evidence explain that state;
- next actions provide deterministic operational guidance;
- readiness shows evidence completeness, never profit probability;
- coaching fields may appear in a visually secondary educational area;
- all text must be rendered as plain text;
- the UI must remain fully usable when coaching fields are absent.

Release 2 must not reproduce verdict mapping, evidence-mode logic, or action derivation in components.

## Technical debt before Release 3

Before Command Center persistence or longitudinal reuse, address:

1. **Stable reason codes** — replace index/message-derived reason identifiers with stable engine-owned codes.
2. **Schema and builder versioning** — distinguish public schema version, deterministic builder version, engine version, and any prompt version.
3. **Decision identifiers** — assign a durable identifier to each completed validation decision.
4. **Strategy provenance** — record the strategy identifier and immutable strategy/version snapshot used for the decision.
5. **Timestamp separation** — distinguish market-analysis time, validation time, narrative-generation time, and eventual persistence time.

The current narrative is suitable as an API read model. It should not be persisted as a durable decision event until those provenance and identifier concerns are resolved.

## Automatic Market Intelligence migration deferrals

The legacy analysis contains named evidence values that are not standalone market-state observations. They must not be forced into snapshot-only detectors merely because the legacy evidence map calls them automatic evidence.

### Phase 2.7 — Premium / Discount proxy: intentionally deferred

The audited implementation is in `lib/market-analysis.ts`, inside `buildLiveAnalysis()` (approximately lines 87–93):

```text
entryRangeHigh = entryTimeframe.lastSwingHigh
entryRangeLow = entryTimeframe.lastSwingLow
equilibrium = (entryRangeHigh + entryRangeLow) / 2
currentPrice = latest close from triggerTimeframe ?? entryTimeframe

premiumDiscount =
  Boolean(direction)
  AND entryRangeHigh and entryRangeLow are available
  AND (currentPrice > equilibrium) === (direction === BUY)
```

Exact boundary behavior:

- no aligned direction produces `false`;
- BUY produces `true` only above equilibrium;
- SELL produces `true` at or below equilibrium, so equality passes for SELL;
- there is no neutral `EQUILIBRIUM` observation;
- the range and current price may come from different timeframes.

This is strategy-dependent directional evidence, not a `MarketDataSnapshot`-only observation. Phase 2.7 therefore adds no detector and no strategy-independent range-location substitute. The formula is deferred to the future Strategy/Composition Layer, which owns direction and multi-timeframe role selection.

### Phase 2.8 — Legacy ChoCH: intentionally deferred from detector extraction

The audited implementation is in `lib/market-analysis.ts`, inside `buildLiveAnalysis()` (approximately lines 87–93):

```text
execution = [entryTimeframeAnalysis, triggerTimeframeAnalysis]

directionalSweep =
  BUY  ? confirmation.sweepLow  OR any execution sweepLow
  SELL ? confirmation.sweepHigh OR any execution sweepHigh
       : false

directionalBos =
  BUY  ? confirmation.bosUp   OR any execution bosUp
  SELL ? confirmation.bosDown OR any execution bosDown
       : false

chochConfirmed = directionalSweep AND directionalBos
```

`direction` is available only when the configured macro/trend/confirmation layers contain at least two aligned, non-range biases. Consequently, legacy ChoCH depends on:

- strategy-configured timeframe roles;
- multi-timeframe directional alignment;
- BUY/SELL interpretation;
- direction-filtered Liquidity Sweep observations;
- direction-filtered BOS observations;
- OR aggregation across confirmation, entry, and trigger timeframes.

The legacy proxy does not require the sweep to precede the BOS. The two booleans may originate from different timeframes, and it does not identify a prior structural character, broken swing, or ordered change event. It is therefore a strategy-aware evidence composition, not an independent ChoCH market detector.

Phase 2.8 adds no detector. Exact legacy migration belongs in the future Strategy/Composition Layer, consuming immutable detector observations for Trend, Liquidity Sweep, and BOS. A future true structural ChoCH detector would be brand-new functionality and must not claim legacy parity.

## Phase 3.0 — Full pipeline migration validation

Phase 3 introduces a dormant, validation-only projection and comparison boundary:

```text
one immutable multi-timeframe bundle
        ├── independent legacy observation projection
        └── MarketContext projection per timeframe
                         ↓
              validation-only composition
                         ↓
                three-level comparison
```

The detector layer owns snapshot-local observations only. The validation composition layer owns direction-filtered, multi-timeframe legacy evidence, including the exact Premium/Discount and legacy ChoCH proxies documented above. Strategy scoring, readiness, risk, and trade candidates remain outside both layers.

Validation occurs at three levels:

1. snapshot-local observation parity;
2. cross-timeframe composition parity and contributing timeframe sets;
3. independently supplied final evidence, score, readiness, blocker, and reason parity.

Migration readiness is conservative. It requires matching snapshot identities, no critical mismatch, no unavailable or non-comparable required field, matching deferred compositions, and complete independent final projections. Missing final scoring/readiness projections block readiness rather than being inferred through the production runtime. The production `calculatedAt` clock is classified as non-deterministic but display-only and is excluded from migration-critical parity.

Known blocker: a future Strategy/Composition validation adapter must independently project the active strategy's Trading DNA score, readiness, blockers, reasons, status, and candidate inputs. Reusing the production scorer on both sides would not prove migration parity.

## Phase 4.3 — Confidence Engine v1

The dormant Confidence Engine consumes only a compiled declarative strategy, its already-evaluated `StrategyContext`, and the corresponding `EvidenceGraph`:

```text
CompiledStrategyDefinition ─┐
StrategyContext ────────────┼──> ConfidenceEngine ──> ConfidenceAssessment
EvidenceGraph ──────────────┘
```

For each enabled rule, configured weight comes directly from the compiled definition. `MATCHED` earns and includes that weight; `FAILED` and `ERROR` include the weight but earn zero. `NOT_EVALUATED` follows the compiled behavior: `NOT_EVALUATED` excludes weight and reports partial evidence, `FAIL` includes weight with zero earned, and `IGNORE` excludes weight without treating the absence as a failure. The compiler maps an omitted behavior to `NOT_EVALUATED` for backward-compatible explicit semantics.

The unrounded calculation is:

```text
confidenceRatio = eligibleWeight > 0 ? rawEarnedWeight / eligibleWeight : null
confidencePercent = confidenceRatio != null ? confidenceRatio * 100 : null
configuredCoverageRatio = configuredWeight > 0 ? eligibleWeight / configuredWeight : null
configuredCoveragePercent = configuredCoverageRatio != null ? configuredCoverageRatio * 100 : null
```

Configured weight describes the full strategy configuration; eligible weight describes the portion with evidence included under the missing-evidence policy. Required and optional rules use the same arithmetic in v1, while their failed and unavailable IDs are reported separately. A required failure is not a veto and does not force confidence to zero.

Confidence means the weighted match ratio among eligible configured evidence. It is not probability, expected win rate, readiness, approval, or a trade recommendation. Phase 4.3 defines no thresholds and makes no BUY/SELL, entry, risk, or execution decision. Those policy concerns remain outside the Confidence Engine.

## Phase 4.4 — Readiness Policy Engine v1

The dormant readiness layer consumes immutable outputs without recalculating them:

```text
CompiledStrategyDefinition ─┐
StrategyContext ────────────┤
EvidenceGraph ──────────────┼──> ReadinessPolicyEngine ──> ReadinessAssessment
ConfidenceAssessment ───────┤
ReadinessPolicy ────────────┘
```

`ReadinessPolicy` is a versioned declarative contract containing inclusive confidence and coverage thresholds, required-rule behavior, rule-error and partial-confidence behavior, optional matched/failure counts, deterministic criterion order, and schema metadata. It does not accept callbacks or arbitrary formulas.

Each criterion reports `PASSED`, `FAILED`, `NOT_EVALUATED`, or `ERROR`, with `INFO`, `WARNING`, or `BLOCKING` severity. Results expose actual and expected values, the exact comparison operator, related rule IDs, and existing Evidence Graph node IDs. Detector payloads are not copied or reinterpreted.

Final status uses conservative deterministic precedence:

```text
ERROR > UNAVAILABLE > BLOCKED > WAIT > READY
```

Malformed identities or fatal confidence errors produce `ERROR`; unusable confidence or coverage produces `UNAVAILABLE`; blocking failures produce `BLOCKED`; non-blocking failed criteria produce `WAIT`; only otherwise-complete inputs produce `READY`.

Confidence describes the weighted match ratio among eligible evidence. Readiness applies a declared completeness policy to that confidence and the existing rule results. `READY` means only that the evaluated setup satisfies the selected readiness policy. It does not mean BUY, SELL, approval, execution authorization, or expected profitability. Phase 4.4 cannot select direction, calculate trade parameters or risk, or execute a trade.

## Phase 5.0 — Decision Engine foundations

```text
CompiledStrategyDefinition ─┐
StrategyContext ────────────┤
EvidenceGraph ──────────────┤
ConfidenceAssessment ───────┼──> DecisionEngine ──> DecisionAssessment
ReadinessAssessment ────────┤
DecisionPolicy ─────────────┘
```

The dormant engine treats upstream confidence and readiness as authoritative and adds only declarative actionability criteria. Status precedence is `ERROR > UNAVAILABLE > BLOCKED > DEFERRED > DECIDED`; outcomes map to `ERROR`, `UNAVAILABLE`, `BLOCKED`, `DEFER`, `ACTIONABLE`, or `NO_ACTION`.

Readiness asks whether setup evidence satisfies a completeness policy. Actionability asks whether that assessment may advance to a future directional stage. `READY` does not guarantee `ACTIONABLE`, and `ACTIONABLE` does not mean BUY, SELL, LONG, SHORT, or execution authorization. Phase 5.0 cannot infer direction, calculate trade parameters or risk, create orders, or execute trades.
## Phase 5.1: Direction Resolution

Direction resolution is a dormant, deterministic layer downstream of actionability:

```text
CompiledStrategyDefinition + StrategyContext + EvidenceGraph
ConfidenceAssessment + ReadinessAssessment + DecisionAssessment
                              + DirectionPolicy
                                      |
                                      v
                         DirectionResolutionEngine
                                      |
                                      v
                           DirectionAssessment
```

Direction semantics belong to the compiled strategy. `FIXED` preserves an explicit BUY or SELL intent, `RULE_DERIVED` evaluates only named composition-rule results, and `DUAL_SCENARIO` preserves independent bullish and bearish support. The engine never scans detector observations, parses explanations, or treats failure on one side as evidence for the other. Rule priority controls evaluation order only; it cannot break a conflict.

`DecisionAssessment` is authoritative. The default policy permits resolution only for `ACTIONABLE`; a separately marked diagnostic policy may inspect `NO_ACTION`. `DEFER`, `BLOCKED`, `UNAVAILABLE`, and `ERROR` never yield BUY or SELL. Both-sided support follows the configured conflict behavior (`CONFLICTED`, `NO_DIRECTION`, or `ERROR`), while absent support follows policy (`NO_DIRECTION` or `UNAVAILABLE`).

`ACTIONABLE` and direction answer different questions: actionability says whether a setup may advance, while BUY or SELL records the strategy-supported directional conclusion. A BUY or SELL `DirectionAssessment` is not an order. This phase calculates no entry, stop, target, position size, leverage, monetary risk, or execution instruction, and it has no production integration, persistence, or telemetry.
## Beta integration: end-to-end orchestration

The dormant beta pipeline composes the nine existing layers in a fixed order:

```text
MARKET_DATA → DETECTORS → MARKET_CONTEXT → STRATEGY_COMPOSITION
→ EVIDENCE_GRAPH → CONFIDENCE → READINESS → DECISION → DIRECTION
```

Every stage records its requested-time origin, input identities, output identity, warnings, safe errors, and a deliberately null duration. A failure records all remaining stages as unavailable and never fabricates downstream output. Detector failures may remain partial because the runner preserves explicit error results. The complete result is deeply frozen and fingerprinted from immutable inputs and stage outputs.

Five server-resolved flags govern application selection: `MARKET_INTELLIGENCE_V2_ENABLED` defaults false; `MARKET_INTELLIGENCE_V2_ADMIN_ONLY` and `MARKET_INTELLIGENCE_V2_BETA_ONLY` default true; `MARKET_INTELLIGENCE_V2_SHADOW_MODE` and `MARKET_INTELLIGENCE_V2_ALLOW_FALLBACK` default true. Eligibility comes from authenticated server identity, administrative role, trusted account metadata, or a controlled server allowlist. Client state cannot grant access. Only administrators receive stage diagnostics; normal beta views omit internal IDs, graph JSON, detector payloads, and raw errors.

Shadow mode keeps the legacy response authoritative and creates a non-persistent comparison. Active beta mode returns a distinct V2 presentation rather than merging legacy and V2 conclusions. An unavailable V2 result either falls back wholesale to legacy or returns a safe unavailable state. The beta presentation labels itself informational decision support and includes no trade parameters or execution controls.

The live route must remain disabled until each eligible production strategy has an authoritative compiled V2 definition. Legacy profiles currently do not encode the explicit direction configuration required by Phase 5.1, and the beta layer must not infer or fabricate it.
