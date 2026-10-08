# Detector Dependency Audit

Audit scope: the registered Market Intelligence detectors and executable backtester on `feature/v22-backtesting-engine`. Registry labels alone are not treated as executable support.

| Required concept | Status | Existing capability | Blocking gap |
|---|---|---|---|
| Swing high | SUPPORTED | `confirmed-swing@1.0.0` applies configurable left/right confirmation and exposes its replay-safe `confirmedAt`. | None for confirmed swing detection. |
| Swing low | SUPPORTED | `confirmed-swing@1.0.0` applies configurable left/right confirmation and exposes its replay-safe `confirmedAt`. | None for confirmed swing detection. |
| Chronological structure state | SUPPORTED | `market-structure-reducer@1.0.0` classifies confirmed swings by `confirmedAt` into HH, HL, LH, LL, EH, and EL with conservative bias snapshots. | None for chronological structure-state reduction. |
| Break of structure | SUPPORTED | `confirmed-structure-bos@1.0.0` requires a completed close beyond an eligible accepted confirmed swing using a structure snapshot available before the breakout candle. | None for replay-safe confirmed-structure BOS detection. |
| Market structure shift | SUPPORTED | `market-structure-shift@1.0.0` classifies immutable confirmed BOS events against their exact prior structure snapshot and protected HL/LH. | None for replay-safe MSS classification. |
| Change of character | SUPPORTED | `market-structure-shift@1.0.0` labels the first accepted protected counter-structure break in a directional regime as CHOCH without claiming reversal certainty. | None for the preregistered transition-risk label. |
| Fair value gap | SUPPORTED | `fair-value-gap-lifecycle@1.0.0` detects strict completed three-candle wick gaps and maintains deterministic creation, mitigation, invalidation, and expiration history. | None for replay-safe FVG lifecycle detection. |
| Liquidity sweep | SUPPORTED | `structural-liquidity-sweep@1.0.0` detects deterministic wick excursions and completed-close reclaims against replay-safe confirmed structural highs/lows. | None for confirmed structural sweep detection. |
| Structural stop placement | SUPPORTED | `structural-stop-candidate@1.0.0` generates replay-safe protected-swing, latest-swing, sweep-extreme, FVG-boundary, and structural-invalidation candidates with explicit optional buffers. | None for objective candidate generation; final stop selection and executable strategy mapping remain composition work. |
| Liquidity target detection | SUPPORTED | `structural-liquidity-target@1.0.0` registers confirmed structural highs/lows and equal-level clusters with immutable BOS/sweep consumption, lifecycle, and neutral distance ranking. | None for replay-safe objective liquidity target facts; strategy-specific TP selection remains composition work. |
| Executable strategy composition | PARTIALLY_SUPPORTED | `xauusd-structure-pullback-composer@1.0.0` verifies the frozen DNA hash, evaluates every rule, binds exact immutable facts, preserves historical state, and blocks unresolved semantics. | Required sweep binding, FVG-to-shift association, rejection geometry, combined stop construction, and entry-dependent RR remain unspecified or unavailable. |

Conclusion: `DETECTOR_IMPLEMENTATION_REQUIRED`. No executable mapping is created. In particular, EMA rules, generic breakouts, and rolling-window extrema are prohibited substitutes.

## Required detector specifications

### Confirmed Swing Detector

- Formal definition: for left width `L` and right width `R`, candle `i` is a swing high when its high is strictly greater than every completed candle high in `[i-L, i-1]` and `[i+1, i+R]`; a swing low is strictly lower than every corresponding low. Equality policy is `NOT_A_SWING`.
- Inputs: immutable `MarketDataSnapshot`, timeframe, completed candles.
- Parameters: `leftBars`, `rightBars`, equality policy (frozen strict for v1), optional minimum excursion (disabled for v1).
- Output: swing ID, type, price, pivot candle time, `confirmedAt` close time of candle `i+R`, widths, evidence candle times, quality metadata.
- Invalid states: insufficient left/right history, malformed OHLC, unordered or duplicate timestamps, incomplete confirmation candle.
- Anti-look-ahead: the swing is unavailable before `confirmedAt`; replay consumers must use `confirmedAt`, never the earlier pivot timestamp, as its first-known time.
- Tests: high, low, equality, boundary history, right-side delay, incomplete confirmation candle, ordering, replay identity.
- Ambiguities: equal highs/lows, nested swings, and minimum excursion. V1 freezes strict inequality and emits all confirmed swings.
- Quality: normalized prominence relative to local range may be metadata only and cannot alter classification unless separately versioned.

### Confirmed-Structure BOS Detector

- Formal definition: a bullish BOS is the first completed close strictly above the latest eligible confirmed swing high while prevailing confirmed structure is bullish; bearish is symmetric below the latest eligible confirmed swing low.
- Inputs: immutable snapshot and confirmed swings known no later than the event candle close.
- Parameters: eligible swing tier, close comparison (strict), one-event-per-level.
- Output: direction, broken swing ID/price, event close/time, prior structure state, distance, evidence.
- Invalid states: no eligible confirmed swing, unknown structure state, malformed data.
- Anti-look-ahead: only swings whose `confirmedAt` is at or before the event close may be referenced.
- Tests: bullish, bearish, equality, wick-only break, repeat break, late-known pivot, unknown state.
- Ambiguities: initial prevailing state and nested structure tier must be frozen before implementation.
- Quality: break distance and swing prominence as descriptive metadata.

### Market Structure Shift Detector

- Formal definition: an aligned confirmed BOS is `CONTINUATION_BREAK`. A confirmed BOS against established bullish/bearish bias qualifies only when it breaks the latest protected HL/LH respectively. In `CHOCH_FIRST_THEN_MSS`, the first accepted counter break in that immutable bias regime is `CHOCH`; a later qualifying break of a new protected swing is `MARKET_STRUCTURE_SHIFT`. CHOCH indicates transition risk, not a confirmed reversal.
- Inputs: immutable `BreakOfStructureEvent`, its exact prior `StructureSnapshot`, and already-confirmed swings. Optional completed candles are used only by the disabled-by-default ATR displacement filter.
- Parameters: terminology, minimum directional snapshots, protected-swing policy, duplicate policy, transition reset policy, and optional absolute/relative/ATR displacement thresholds.
- Output: continuation/CHOCH/MSS/unclassified label, source BOS and protected swing identities, prior bias, distances, transition regime hash, deterministic evidence, acceptance state, and rejection reason.
- Invalid states: uninitialized or mixed structure, missing/late protected swing, mismatched source level, insufficient directional history, duplicate protected-level shift, or insufficient ATR history.
- Anti-look-ahead: the exact source snapshot and protected swing must exist no later than breakout open; `detectedAt` is copied from the immutable BOS; later swings and snapshots cannot rewrite the event.
- Tests: both continuation directions, both transition directions, mixed/undefined state, missing/non-protected level, terminology modes, regime progression, future leakage, displacement equality, duplicate policies, batch/incremental parity, stable serialization, and reset.
- State machine: regime identity is a stable hash of the first contiguous snapshot in the prior directional bias. Opposite directional structure starts a new regime; historical classifications are never renamed.
- Quality: prior directional snapshot count and absolute, relative, and optional ATR-normalized break distance.

### Stateful Fair Value Gap Detector

- Formal definition: bullish gap when completed candle `i.low > candle i-2.high + tolerance`; bearish when `i.high < candle i-2.low - tolerance`. Bounds are wick-to-wick and the gap is invisible until candle `i` closes.
- Inputs: completed normalized candles only; optional shared SIMPLE ATR uses history available through creation.
- Parameters: absolute/relative tolerance and size minima, optional ATR minimum, mitigation thresholds, far-boundary invalidation, candle/time expiration, overlap behavior, and explicit creation-candle lifecycle policy.
- Output: stable gap identity and bounds, current state, maximum fill, remaining bounds, creation provenance, immutable lifecycle event IDs/timestamps, descriptive C2 displacement metadata, and deterministic evidence.
- Invalid states: fewer than three completed candles, malformed/duplicate data, below-minimum gap, insufficient configured ATR, nested-gap rejection, and invalid configuration.
- Anti-look-ahead: C1/C2/C3 must be completed; creation is known only at C3 close; lifecycle normally begins with the next completed candle; ATR and every state transition use only then-available candles.
- Tests: both directions, equality/tolerances, size and ATR thresholds, first touch, partial/full fill, monotonic maximum fill, invalidation priority, expiration, overlap policies, nested rejection, terminal immutability, batch/incremental parity, stable identities, evidence, and isolation.
- State machine: `ACTIVE → PARTIALLY_MITIGATED → FULLY_MITIGATED`, or a non-terminal state to `INVALIDATED`/`EXPIRED`; terminal gaps never evolve. Invalidation wins same-candle conflicts without implying intrabar chronology.
- Quality: absolute/relative/ATR-normalized size, midpoint, C2 body/range, fill percentage, and remaining zone are descriptive metadata only.

### Confirmed-Liquidity Sweep Detector

- Formal definition: buy-side sweep requires a completed candle high strictly above an eligible confirmed structural high plus tolerance and a close at or inside its configured reclaim boundary; sell-side is symmetric below a confirmed structural low. A sweep is liquidity-removal evidence, not institutional intent or reversal confirmation.
- Inputs: completed candles, replay-safe confirmed swings, chronological structure snapshots, and optional immutable BOS events for explicit same-level/same-candle conflict handling.
- Parameters: latest/all accepted source eligibility, allowed structural labels, excursion/reclaim tolerances, optional absolute/relative/ATR excursion minima, close policy, BOS conflict, consumption/reset, gap, and dual-sweep policies.
- Output: side, immutable source swing/snapshot context, candle OHLC and timestamps, excursion/reclaim metadata, optional ATR multiple and conflicting BOS ID, consumption state, evidence, rejection reason, and stable fingerprint.
- Invalid states: unconfirmed or late source, unavailable structural snapshot, consumed source, BOS conflict, ambiguous dual sweep, rejected gap, insufficient ATR, malformed data, and retroactive incremental input.
- Anti-look-ahead: source swing and structural snapshot must predate candle open; the event is visible only at candle close; later BOS, structure, swings, and candles cannot rewrite history.
- Tests: both sides, reclaim/equality, source policies, multiple levels, BOS conflict modes, consumption/reset, gaps, dual sweep policies, thresholds, ATR safety, batch/incremental parity, time travel, future-data invariance, fingerprints, evidence, and isolation.
- Ambiguities: equal-high/low clustering remains a future source-level capability; ordered dual policies define serialization only and never infer intrabar chronology.
- Quality: absolute/relative/ATR-normalized excursion, reclaim distance, wick beyond level, and close position are descriptive metadata only.

### Structural Risk-Level Resolver

- Market-fact generator: `structural-stop-candidate@1.0.0` consumes immutable confirmed swings, structure snapshots, structural sweeps, FVG lifecycle state, BOS, and transition events without recalculating them.
- Candidate types: protected swing, latest confirmed swing, sweep extreme, FVG far boundary, and explicit structural invalidation level. Direction is supplied by the caller and is never inferred from structure.
- Historical state: sources must exist by the reference timestamp; FVG terminal changes after that timestamp cannot rewrite earlier output; optional SIMPLE ATR uses completed candles available at the reference only.
- Buffer policy: none, absolute, relative, ATR, or maximum configured. Long buffers subtract from the raw level and short buffers add. Missing required ATR rejects explicitly and never becomes zero.
- Validity: under the default policy, long candidates must be strictly below reference price and short candidates strictly above; invalid candidates remain in audited rejection output.
- Ranking: distance, structural priority, or hybrid ordering is descriptive and never selects or recommends a final stop. Equal effective prices remain separate by default or may merge provenance under explicit deterministic tolerance.
- APIs: stateless batch generation and stateful immutable-source query ingestion produce byte-identical results for equivalent reference-time information.
- Remaining composition work: the preregistered strategy's exact `min(originSwingLow, zoneLow) - ATR(14)*0.10` / symmetric short rule still requires an executable strategy mapping to choose among objective candidates. This generator intentionally does not make that strategy decision.

### Opposing Liquidity Target Resolver

- Market-fact detector: `structural-liquidity-target@1.0.0` creates BUY_SIDE facts from accepted confirmed structural highs and SELL_SIDE facts from accepted confirmed structural lows. It also creates equal-high/low clusters only when the configured minimum membership is chronologically confirmed.
- Cluster policy: member prices are combined by arithmetic mean. The first minimum-membership set freezes the cluster ID and creation event; later members update current provenance through immutable `MEMBER_ADDED` events. A member sweep consumes the full cluster only when its excursion crosses the complete cluster boundary.
- Lifecycle: `AVAILABLE → TESTED`, or a non-terminal state to `SWEPT`, `BROKEN`, `INVALIDATED`, or `EXPIRED`. BOS wins equal-timestamp conflicts, and terminal targets never evolve.
- Inputs: confirmed swings, accepted chronological structure classifications, completed candles, and existing immutable BOS and structural-sweep events. No source event is recalculated.
- Ranking: neutral absolute, relative, or caller-supplied ATR-normalized distance with deterministic time/ID tie-breakers; it does not select a trade direction, take-profit, reward-to-risk, or reach probability.
- Anti-look-ahead: targets appear at classification confirmation, clusters only at minimum membership, candle events only at close, and BOS/sweep consumption only at immutable event time. Incremental input rejects retroactive structure.
- Deferred: previous-day/week levels are intentionally absent because no broker-session/calendar convention is frozen for this research module.
- Remaining composition work: selecting the nearest opposing target beyond a proposed entry and enforcing minimum 2.0 reward-to-structural-risk remains strategy-specific and is not performed by the detector.

## Composition and execution work

`xauusd-structure-pullback-composer@1.0.0` now provides deterministic batch and stateful reference-time composition without recalculating detectors. It verifies the exact raw Strategy DNA SHA-256, emits one evaluation for every frozen condition, produces an immutable provenance graph, and never selects a stop or target without exact semantics.

The audit found mandatory unresolved semantics that prevent executable mapping:

- Liquidity sweep is a required dependency, but the long/short entry rules define no required side, relationship, or event ordering.
- The originating FVG must be “created by or immediately following” the shift, but no exact source relationship or maximum candle/event separation is defined.
- The trigger says a candle “rejects the zone,” but wick, close, penetration, and invalidation geometry are not formally specified.
- Session windows are exact, but trigger and next-open timestamps cannot be bound until the trigger is executable.
- The stop requires the minimum/maximum of structural origin and retracement-zone boundary plus ATR; current objective candidates expose those facts separately and may not be silently substituted for the combined formula.
- Nearest opposing liquidity and minimum 2.0 RR are exact only after deterministic entry and stop prices exist.

Therefore the conclusion remains `DETECTOR_IMPLEMENTATION_REQUIRED`, the immutable strategy and manifest research status remain unchanged, no executable mapping is created, and no official backtest is authorized. Resolving these rules requires a new explicitly governed Strategy DNA version or a preregistration clarification process; the composer cannot invent them.
