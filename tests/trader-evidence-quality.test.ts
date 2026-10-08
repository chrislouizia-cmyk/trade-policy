import test from "node:test";
import assert from "node:assert/strict";
import { buildTraderLearning, type LearningTrade } from "../lib/trader-learning.ts";
import { assessPatternEvidence } from "../lib/trader-pattern-evidence.ts";
import { buildTraderInterventions } from "../lib/trader-intelligence.ts";
import { evaluateRecommendationFollowup } from "../lib/trader-recommendation-evaluation.ts";

const now = new Date("2026-10-08T12:00:00Z");
const trade = (id: string, extra: Partial<LearningTrade> = {}): LearningTrade => ({
  id, user_id: "alice", source: "EXECUTED", status: "CLOSED", instrument: "XAUUSD",
  opened_at: "2026-10-07T10:00:00Z", closed_at: "2026-10-07T11:00:00Z", result_r: -1, ...extra,
});
const records = (n: number, result = -1) => Array.from({ length: n }, (_, i) => ({
  result_r: result, closed_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(),
}));

test("missing risks and unknown verdicts stay unknown, including execution metadata", () => {
  const summary = buildTraderLearning("alice", [trade("a"), trade("b", { risk_percent: "" }),
    trade("c", { risk_percent: 0.5 }), trade("d", { risk_percent: -2 })],
    [{ trade_record_id: "a", taken_against_verdict: true }], now);
  assert.equal(summary.behavior.averageRiskPercent, 0.5);
  assert.equal(summary.behavior.riskSampleSize, 1);
  assert.equal(summary.behavior.overrideTrades, 1);
  assert.equal(summary.behavior.adherenceRate, 0);
  assert.equal(summary.quality?.unknownAdherence, 3);
  assert.equal(summary.quality?.missingRisk, 3);
  assert.equal(summary.quality?.brokerVerified, false);
  assert.equal(buildTraderInterventions(summary, { stage: "PRE_TRADE", riskPercent: 1, at: now })
    .some(row => row.key.includes("risk-drift")), false);
});

test("invalid, future, reversed and simulated outcomes do not enter learning", () => {
  const summary = buildTraderLearning("alice", [trade("valid"), trade("bad", { closed_at: "bad" }),
    trade("future", { closed_at: "2027-01-01" }), trade("reversed", { opened_at: "2026-10-08" }),
    trade("sim", { strategy_snapshot: { internalTestMode: true } })], [], now);
  assert.deepEqual(summary.evidenceIds, ["valid"]);
});

test("overlapping trades never learn outcomes that were unknown when entering", () => {
  const rows = Array.from({ length: 4 }, (_, i) => trade(String(i), {
    opened_at: `2026-10-07T10:0${i}:00Z`, closed_at: `2026-10-07T11:0${i}:00Z`,
  }));
  const summary = buildTraderLearning("alice", rows, [], now);
  assert.equal(summary.dimensions.some(row => row.dimension === "after_outcome"), false);
});

test("current streak follows close order rather than entry order", () => {
  const summary = buildTraderLearning("alice", [trade("long", { closed_at: "2026-10-07T12:00:00Z", result_r: 1 }),
    trade("short", { opened_at: "2026-10-07T10:30:00Z", result_r: -1 })], [], now);
  assert.equal(summary.behavior.currentWinStreak, 1);
  assert.equal(summary.behavior.currentLossStreak, 0);
});

test("sample count alone cannot establish a repeated pattern", () => {
  const sameDay = Array.from({ length: 60 }, () => ({ result_r: -1, closed_at: "2026-10-07T11:00:00Z" }));
  assert.equal(assessPatternEvidence(sameDay, now, "UTC").status, "OBSERVED");
  assert.equal(assessPatternEvidence(records(30), now, "UTC").status, "REPEATED");
});

test("later contradictions and stale records retire the old coaching direction", () => {
  const changed = records(30).map((row, i) => ({ ...row, result_r: i < 20 ? -1 : 1 }));
  assert.equal(assessPatternEvidence(changed, now, "UTC").status, "CONFLICTING");
  assert.equal(assessPatternEvidence(records(30), new Date("2027-10-08"), "UTC").status, "STALE");
  const summary = buildTraderLearning("alice", changed.map((row, i) => trade(String(i), {
    opened_at: row.closed_at, closed_at: row.closed_at, result_r: row.result_r,
  })), [], now);
  assert.equal(buildTraderInterventions(summary, { stage: "PRE_TRADE", instrument: "XAUUSD", at: now })
    .some(row => row.key.includes(":instrument:")), false);
});

test("follow-up excludes baseline, pre-delivery entries, duplicates and other contexts", () => {
  const baseline = { capturedAt: "2026-10-01", evidenceIds: ["old"], metric: -1 };
  const later = Array.from({ length: 5 }, (_, i) => ({ id: String(i), openedAt: "2026-10-02",
    closedAt: "2026-10-03", resultR: 1 }));
  const outcome = evaluateRecommendationFollowup(baseline, [...later, later[0],
    { ...later[0], id: "old" }, { ...later[0], id: "already-open", openedAt: "2026-09-30" }]);
  assert.equal(outcome?.subsequentTrades, 5);
  assert.equal(outcome?.metric, 1);
  assert.equal(outcome?.change, 2);
  assert.match(outcome!.interpretation, /not causal/);
  assert.equal(evaluateRecommendationFollowup(baseline, later, ["0", "1"]), null);
  assert.equal(evaluateRecommendationFollowup({ capturedAt: "2026-10-01" }, later), null);
});
