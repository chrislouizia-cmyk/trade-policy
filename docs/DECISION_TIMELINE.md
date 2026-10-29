# Deterministic Decision Timeline

The Decision Timeline is a pure presentation of timestamps already recorded by Trade Police. It does not call a provider, rerun analysis, inspect current Strategy DNA, parse prose, or ask AI to order events.

## Accepted event sources

- `MARKET_DATA_VERIFIED` uses the recorded market calculation completion time, not the latest candle’s market timestamp.
- `RULE_CONFIRMED`, `RULE_BECAME_MISSING`, and `RULE_VIOLATED` use deterministic evidence items only when `detectedAt` exists and is valid.
- Current `FINAL_RISK_CHECK_COMPLETED` and `VERDICT_PRODUCED` events use the deterministic narrative generation time recorded immediately after the final engine result.
- Historical `VERDICT_PRODUCED` uses the immutable snapshot `createdAt` value.

`SETUP_DETECTED` and `REPORT_SAVED` are valid model types but are not emitted until their timestamps exist in the relevant immutable source. The latest candle timestamp remains provenance and is never mislabeled as verification time.

## Timestamp and ordering rules

Missing or invalid timestamps produce no event. Events sort by timestamp and then by: market verification, confirmed rule, missing rule, violated rule, setup detection, final risk check, verdict, report save, and stable event ID. Descriptions restate structured evidence state; they are not derived from narrative prose.

## Sparse data

If no timestamped rule events exist, the report states: “Detailed event timing was not available for this analysis.” Available market or verdict events remain visible, while untimed rules stay in the evidence section. No intermediate steps are reconstructed.

## AI exclusion

The timeline transformation accepts structured deterministic evidence, verdict, and timestamp fields only. AI-authored educational, coaching, and learning prose is not an input and cannot add, remove, timestamp, or reorder events.

## Historical compatibility and schema decision

Historical timelines use fields already stored inside immutable snapshot schema `1.0.0`. Sprint 4B does not add timeline JSON, modify existing snapshots, migrate reports, or change deterministic fingerprints. Unknown versions continue to render the safe unsupported-version state.

## Limitations

Older and current reports may not contain dedicated setup-detection, risk-check, or report-save timestamps. Those events are intentionally absent. The timeline explains recorded chronology; it is not a market chart, execution log, or reconstruction of everything that happened.
