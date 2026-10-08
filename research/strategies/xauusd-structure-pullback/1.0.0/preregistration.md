# Preregistration

## Frozen question

Does `xauusd-structure-pullback@1.0.0` produce positive expected-cost out-of-sample expectancy in R on independently certified XAUUSD M15 periods?

## Freeze

After the first result is inspected, the strategy rules, detector parameters, direction logic, execution assumptions, cost scenarios, split protocol, metrics, and rejection thresholds will not change for version 1.0.0. Any change requires a new strategy version and experiment family.

No backtest is authorized until every required dependency is `SUPPORTED`, the executable mapping is complete, its hash is frozen, and official completeness validation passes.

## Metrics

Primary: expected-cost OOS expectancy in R.

Secondary: expected-cost OOS profit factor, expected-cost maximum drawdown, conservative-cost expectancy, stability by independent period, profit concentration, long/short consistency, and London/New York consistency.

Win rate is descriptive only and is not the primary metric.

## Minimum evidence

- At least 1,000 total executed trades.
- At least 300 OOS trades.
- At least two independent historical periods before `ROBUST_CANDIDATE`.
- Chronological 70/30 IS/OOS split inside each independent period.

## Rejection

Reject on any critical condition: expected-cost OOS expectancy at or below 0R; expected-cost OOS profit factor at or below 1.00; severe positive-IS/negative-OOS sign reversal; expected-cost OOS maximum drawdown above 35R; top-five winning trades exceeding 50% of gross profit; conservative costs eliminating the edge; insufficient valid trades; or an unsupported/ambiguous required detector.

## Robustness

The frozen global research-classification policy applies: at least 1,000 total and 300 OOS trades, expected-cost OOS expectancy at least 0.10R, expected-cost OOS profit factor at least 1.20, conservative expectancy at least 0R, no critical stability warning, no extreme profit concentration, and validation across at least two independent periods.

## Planned data

Three independent, certified XAUUSD M15 periods will be selected using a strategy-independent regime protocol: predominantly bullish, predominantly bearish, and ranging/mixed. Only after those individual results will cross-period aggregation be considered. M5 and H1 are out of scope for the first experiment family.

## Cost scenarios

- Idealized: zero spread, slippage, and commission; diagnostic boundary only.
- Expected: 0.20 price spread, 0.05 price slippage per side, and 0.02R round-trip commission.
- Conservative: 0.40 price spread, 0.10 price slippage per side, and 0.04R round-trip commission.

No parameter optimization, historical profitability assertion, or official backtest is part of this ticket.
