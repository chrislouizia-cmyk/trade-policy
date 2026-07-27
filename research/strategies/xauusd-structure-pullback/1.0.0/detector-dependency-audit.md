# Detector Dependency Audit

Audit scope: the registered Market Intelligence detectors and executable backtester on `feature/v22-backtesting-engine`. Registry labels alone are not treated as executable support.

| Required concept | Status | Existing capability | Blocking gap |
|---|---|---|---|
| Swing high | SUPPORTED | `confirmed-swing@1.0.0` applies configurable left/right confirmation and exposes its replay-safe `confirmedAt`. | None for confirmed swing detection. |
| Swing low | SUPPORTED | `confirmed-swing@1.0.0` applies configurable left/right confirmation and exposes its replay-safe `confirmedAt`. | None for confirmed swing detection. |
| Break of structure | PARTIALLY_SUPPORTED | `break-of-structure@1.0.0` compares the current close with a seven-candle rolling high/low. | It does not reference a confirmed swing or prevailing structure state. |
| Market structure shift | UNSUPPORTED | No registered detector. | Prior directional structure and an opposing confirmed swing break are both absent. |
| Fair value gap | PARTIALLY_SUPPORTED | `fair-value-gap@1.0.0` implements the strict latest-candle legacy three-candle gap. | No minimum-size configuration, event association, mitigation state, or lifecycle. |
| Liquidity sweep | PARTIALLY_SUPPORTED | `liquidity-sweep@1.0.0` detects wick-through/close-back-inside against a rolling window. | The reference is not confirmed structural liquidity. |
| Structural stop placement | UNSUPPORTED | Backtester supports fixed-price, percent, and ATR-multiple distances. | It cannot consume a structural-origin price plus an explicit ATR buffer. |
| Liquidity target detection | UNSUPPORTED | No registered detector or target selector. | It cannot select nearest opposing confirmed liquidity as known at decision time. |

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

- Formal definition: after an established bullish structure state, the first completed close strictly below the latest eligible confirmed opposing swing low is bearish MSS; after bearish structure, a close strictly above the opposing confirmed swing high is bullish MSS.
- Inputs: immutable snapshot, confirmed swing stream, deterministic structure-state reducer.
- Parameters: structure tier, initialization rule, strict close comparison, one-event-per-level.
- Output: shift direction, prior state, new provisional state, broken opposing swing, origin swing, event timestamp, evidence.
- Invalid states: uninitialized structure, missing opposing swing, ambiguous simultaneous state events, malformed data.
- Anti-look-ahead: state is reduced chronologically from confirmed-at events and completed closes only.
- Tests: both directions, no prior state, equality, wick-only, delayed swing confirmation, nested structures, serialization.
- Ambiguities: continuation versus reversal hierarchy and state initialization; resolve by preregistered state-machine specification.
- Quality: number of prior same-direction structure confirmations and normalized break distance.

### Stateful Fair Value Gap Detector

- Formal definition: bullish gap when candle `i.low > candle i-2.high`; bearish when `i.high < i-2.low`, using strict comparison. Gap size must meet configured absolute or ATR-normalized minimum. A gap becomes mitigated when a later completed candle trades to the frozen mitigation threshold.
- Inputs: immutable snapshot and completed candles; optional shared ATR primitive.
- Parameters: minimum size mode/value, mitigation threshold (`TOUCH`, `MIDPOINT`, or `FULL_FILL`), maximum age, event association window.
- Output: gap ID, direction, bounds, size, created/known time, mitigation state/time, age, associated structure event ID when present.
- Invalid states: fewer than three candles, invalid geometry/timestamps, unavailable ATR when configured.
- Anti-look-ahead: creation is known only at candle `i` close; mitigation uses subsequent candles only and is reported as of `requestedAt`.
- Tests: bullish/bearish, equality, size threshold, each mitigation policy, unmitigated lifecycle, incomplete candle, association window.
- Ambiguities: wick versus close mitigation and overlapping gaps; parameters must freeze the policy.
- Quality: size in price/ATR and age, without strategy classification.

### Confirmed-Liquidity Sweep Detector

- Formal definition: high-side sweep when a completed candle high is strictly above an eligible confirmed liquidity level and its close is strictly below that level; low-side is symmetric.
- Inputs: immutable snapshot and confirmed swing/liquidity levels known before the event.
- Parameters: liquidity-level types, maximum level age, strict comparison, reuse policy.
- Output: side, level ID/price, excursion, close-return flag, event timestamp, prior-touch count, evidence.
- Invalid states: no eligible prior level, stale/consumed level, malformed data.
- Anti-look-ahead: the swept level must have been confirmed before the event candle opened; the event is known at its close.
- Tests: high, low, both, equality, wick without return, level confirmed too late, consumed level, incomplete event.
- Ambiguities: level reuse, equal-high liquidity pools, and whether event association is required.
- Quality: excursion normalized by ATR and level age as metadata.

### Structural Risk-Level Resolver

- Formal definition: long stop is `min(originSwingLow, zoneLow) - ATR(14)*0.10`; short stop is `max(originSwingHigh, zoneHigh) + ATR(14)*0.10`. No fallback is permitted in version 1.0.0.
- Inputs: entry candidate, structure event, origin swing, retracement zone, ATR known at decision time.
- Parameters: ATR period/method/buffer multiple.
- Output: stop price, structural origin, buffer, invalidation direction, evidence IDs.
- Invalid states: missing origin/zone/ATR, non-positive risk distance, stop on wrong side of entry.
- Anti-look-ahead: every referenced observation must be known before the entry order time.
- Tests: long/short, selected extrema, buffer exactness, missing evidence, wrong-side stop, deterministic replay.
- Ambiguities: gaps through stop are execution behavior, not detector behavior.
- Quality: risk distance in price and ATR units.

### Opposing Liquidity Target Resolver

- Formal definition: from eligible confirmed opposing swing levels known before entry, select the nearest price beyond entry in the trade direction whose reward-to-structural-risk ratio is at least 2.0. If none exists, reject the setup; no fallback target.
- Inputs: entry price/time, direction, structural stop, confirmed liquidity levels.
- Parameters: eligible level types, minimum RR, tie-breaker (`EARLIEST_CONFIRMED_THEN_ID`), consumed-level policy.
- Output: target level ID/price, reward, risk, RR, known-at time, evidence.
- Invalid states: no eligible target, zero/non-positive risk, target on wrong side, level known after entry.
- Anti-look-ahead: only levels with `confirmedAt <= entryDecisionTime` are eligible.
- Tests: long/short, nearest selection, RR rejection, deterministic tie, late-known level, consumed level, no fallback.
- Ambiguities: pool versus individual swing targets and level consumption must be frozen.
- Quality: RR and level prominence as descriptive metadata.

## Composition and execution work

After the detectors exist, a versioned structure-state reducer and composition rules must bind MSS, displacement, FVG retracement, session, rejection trigger, structural risk, and liquidity target without recalculation. The backtester must then support structural close invalidation and the frozen exit precedence. These are implementation dependencies, not permission to weaken the hypothesis.
