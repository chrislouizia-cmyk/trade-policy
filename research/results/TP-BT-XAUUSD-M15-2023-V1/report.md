# Trade Police deterministic XAUUSD backtest
+
+## Research question
+
+Does the immutable Gold Intraday Research Strategy DNA produce positive and stable historical expectancy on the selected certified XAUUSD M15 dataset under fixed execution rules?
+
+## Dataset provenance and quality
+
+- Source: candles.json (Twelve Data, XAU/USD)
+- SHA-256: `e8c66629b6f83c765685a73704eef868ca5e52269ad0f4f2c8e867ddcf704388`
+- Status: VERIFIED_SOURCE
+- Span: 2023-05-01T00:00:00.000Z — 2023-10-31T23:45:00.000Z
+- Candles: 12049
+- Price representation: UNKNOWN
+- Validation: VALID; gaps=5615; duplicates=0; missing volume=12049; weekend candles=200
+
+## Strategy DNA snapshot and mapping audit
+
+- Strategy: gold-intraday-research@1.0.0
+- Mapping hash: `15dc66f83a12c4af`
+- Supported: trend-alignment, retest, displacement
+- Partially supported: none
+- Unsupported: none
+- Omitted fields: validation.description, validation.tags, validation.author
+- Interpretations: The 50/25/25 confidence weights and 70% policy threshold are mapped to required trend alignment plus at least one of retest or displacement (minimum two confirmations). Trend uses the exact legacy SMA10>SMA24 and close>SMA24 bullish formula. Retest and displacement use their exact legacy formulas. The stored composition definition has no exit rules; the baseline preregisters ATR(14) 1.0x stop, ATR(14) 2.0x target, and 20-bar maximum holding solely as transparent execution assumptions.
+- Warnings: Stop, target, and maximum holding period are research execution assumptions absent from the stored Strategy DNA; conclusions are conditional on them.
+
+## Baseline and IS/OOS results
+
+| Sample | Trades | Net R | Expectancy | Profit factor | Max drawdown R | Classification |
+|---|---:|---:|---:|---:|---:|---|
+| Full expected-cost baseline | 610 | -142.442 | -0.2335 | 0.706 | 160.518 | NEGATIVE_EXPECTANCY |
+| In sample | 412 | -113.788 | -0.2762 | 0.660 | 119.336 | NEGATIVE_EXPECTANCY |
+| Out of sample | 198 | -28.654 | -0.1447 | 0.808 | 42.757 | NEGATIVE_EXPECTANCY |
+
+Signals found=1391; executed=610; skipped evaluations=11439. Entry is next candle open. Same-bar stop/target conflicts use stop first.
+
+## Execution-cost sensitivity
+
+| Scenario | Trades | Net R | Expectancy | Profit factor | Max drawdown R | Classification |
+|---|---:|---:|---:|---:|---:|---|
+| IDEALIZED | 610 | 0.569 | 0.0009 | 1.001 | 35.953 | ROBUST_CANDIDATE |
| EXPECTED | 610 | -142.442 | -0.2335 | 0.706 | 160.518 | NEGATIVE_EXPECTANCY |
| CONSERVATIVE | 610 | -285.454 | -0.4680 | 0.506 | 292.281 | NEGATIVE_EXPECTANCY |
+
+## Yearly stability
+
+| Year | Trades | Win rate | Expectancy | Profit factor | Net R | Max drawdown R | Reliable |
+|---|---:|---:|---:|---:|---:|---:|---|
+| 2023 | 610 | 34.8% | -0.2335 | 0.706 | -142.442 | 160.518 | true |
+
+## Quarterly and market-condition segments
+
+Quarterly segments: 2023-Q2=181 trades, expectancy -0.2968; 2023-Q3=308 trades, expectancy -0.2881; 2023-Q4=121 trades, expectancy -0.0000.
+
+- DIRECTION/LONG: 610 trades; expectancy=-0.2335; PF=0.706; reliable=true. Formula: Trade direction recorded by the immutable strategy.
- SESSION/LONDON_07_16_UTC: 180 trades; expectancy=-0.1842; PF=0.769; reliable=true. Formula: UTC windows: Tokyo 00–09, London 07–16, New York 13–22; precedence NY, London, Tokyo.
- SESSION/NEW_YORK_13_22_UTC: 151 trades; expectancy=-0.1967; PF=0.708; reliable=true. Formula: UTC windows: Tokyo 00–09, London 07–16, New York 13–22; precedence NY, London, Tokyo.
- SESSION/TOKYO_00_09_UTC: 243 trades; expectancy=-0.3105; PF=0.641; reliable=true. Formula: UTC windows: Tokyo 00–09, London 07–16, New York 13–22; precedence NY, London, Tokyo.
- SESSION/OTHER: 36 trades; expectancy=-0.1149; PF=0.856; reliable=true. Formula: UTC windows: Tokyo 00–09, London 07–16, New York 13–22; precedence NY, London, Tokyo.
- WEEKDAY/MONDAY: 117 trades; expectancy=-0.3339; PF=0.600; reliable=true. Formula: UTC calendar weekday at signal time.
- WEEKDAY/TUESDAY: 121 trades; expectancy=-0.1422; PF=0.809; reliable=true. Formula: UTC calendar weekday at signal time.
- WEEKDAY/WEDNESDAY: 123 trades; expectancy=-0.2642; PF=0.676; reliable=true. Formula: UTC calendar weekday at signal time.
- WEEKDAY/THURSDAY: 117 trades; expectancy=-0.2106; PF=0.725; reliable=true. Formula: UTC calendar weekday at signal time.
- WEEKDAY/FRIDAY: 128 trades; expectancy=-0.2335; PF=0.712; reliable=true. Formula: UTC calendar weekday at signal time.
- WEEKDAY/SUNDAY: 4 trades; expectancy=0.2110; PF=1.324; reliable=false. Formula: UTC calendar weekday at signal time.
- ATR_REGIME/NORMAL: 328 trades; expectancy=-0.2276; PF=0.715; reliable=true. Formula: ATR(14) versus median prior ATR values over at most 100 completed candles: LOW <0.75x, HIGH >1.25x, otherwise NORMAL.
- ATR_REGIME/HIGH: 152 trades; expectancy=-0.1737; PF=0.751; reliable=true. Formula: ATR(14) versus median prior ATR values over at most 100 completed candles: LOW <0.75x, HIGH >1.25x, otherwise NORMAL.
- ATR_REGIME/LOW: 130 trades; expectancy=-0.3183; PF=0.642; reliable=true. Formula: ATR(14) versus median prior ATR values over at most 100 completed candles: LOW <0.75x, HIGH >1.25x, otherwise NORMAL.
- TREND_REGIME/TRENDING: 610 trades; expectancy=-0.2335; PF=0.706; reliable=true. Formula: TRENDING when SMA10>SMA24 and close>SMA24, or SMA10<SMA24 and close<SMA24; otherwise NON_TRENDING.
+
+## Validation warnings and limitations
+
+- Only 610 genuine qualifying trades were found; fewer than the 2,000-trade research target.
+- This is a historical result, not guaranteed or future profitability.
+- The historical result uses bar data; intrabar order is unknown and resolved conservatively.
+- A positive historical expectancy would identify only a research candidate requiring further validation.
+- Spread is fixed rather than reconstructed tick by tick; price representation limitations remain visible above.
+
+## Research classification
+
+**NEGATIVE_EXPECTANCY**
+
+## Reproducibility
+
+Re-run the frozen research command with the same source file, Strategy DNA snapshot, cost scenarios and engine commit. Baseline run ID: `backtest:11a5f29c70ee0e1f`.
+