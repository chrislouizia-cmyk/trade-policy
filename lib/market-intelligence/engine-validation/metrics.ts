import { bootstrapMean, bootstrapStatistic, wilsonInterval } from './statistics.ts';
import type { ClassificationMetrics, EngineValidationProtocol, ReadinessBucket, ThresholdResult, ValidationOpportunity } from './validation-types.ts';

const emptyInterval = (confidenceLevel: number) => ({ estimate: 0, lower: 0, upper: 0, confidenceLevel });
type ScoredOutcome = { score: number; outcome: number };
const correlation = (values: readonly ScoredOutcome[]): number | null => {
  if (values.length < 3) return null;
  const xMean = values.reduce((sum, item) => sum + item.score, 0) / values.length, yMean = values.reduce((sum, item) => sum + item.outcome, 0) / values.length;
  let numerator = 0, xVariance = 0, yVariance = 0;
  for (const item of values) { const x = item.score - xMean, y = item.outcome - yMean; numerator += x * y; xVariance += x * x; yVariance += y * y; }
  return xVariance && yVariance ? numerator / Math.sqrt(xVariance * yVariance) : null;
};
const auc = (values: readonly ScoredOutcome[]): number | null => {
  const positives = values.filter((item) => item.outcome === 1), negatives = values.filter((item) => item.outcome === 0);
  if (!positives.length || !negatives.length) return null;
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive.score > negative.score ? 1 : positive.score === negative.score ? .5 : 0;
  return wins / (positives.length * negatives.length);
};

export function classificationMetrics(rows: readonly ValidationOpportunity[], protocol: EngineValidationProtocol, approval: (row: ValidationOpportunity) => boolean = (row) => row.approved): ClassificationMetrics {
  const evaluable = rows.filter((row) => row.successful !== null && row.direction !== null);
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of evaluable) {
    const approved = approval(row);
    if (approved && row.successful) tp += 1;
    else if (approved) fp += 1;
    else if (row.successful) fn += 1;
    else tn += 1;
  }
  const approvedRows = evaluable.filter(approval), rejected = evaluable.length - approvedRows.length;
  const positive = tp + fn, negative = fp + tn;
  const tpr = positive ? tp / positive : null, tnr = negative ? tn / negative : null;
  const scored = evaluable.flatMap((row) => row.readinessPercent === null ? [] : [{ score: row.readinessPercent, outcome: row.successful ? 1 : 0 }]);
  return {
    sampleSize: rows.length, evaluableDirections: evaluable.length, approved: approvedRows.length, rejected,
    truePositives: tp, falsePositives: fp, trueNegatives: tn, falseNegatives: fn,
    coverage: evaluable.length ? wilsonInterval(approvedRows.length, evaluable.length, protocol.confidenceLevel) : emptyInterval(protocol.confidenceLevel),
    successRate: approvedRows.length ? wilsonInterval(tp, approvedRows.length, protocol.confidenceLevel) : null,
    falsePositiveRate: negative ? wilsonInterval(fp, negative, protocol.confidenceLevel) : null,
    falseNegativeRate: positive ? wilsonInterval(fn, positive, protocol.confidenceLevel) : null,
    precision: approvedRows.length ? wilsonInterval(tp, approvedRows.length, protocol.confidenceLevel) : null,
    recall: positive ? wilsonInterval(tp, positive, protocol.confidenceLevel) : null,
    balancedAccuracy: tpr === null || tnr === null ? null : (tpr + tnr) / 2,
    readinessOutcomeCorrelation: bootstrapStatistic(scored, correlation, protocol.bootstrapIterations, protocol.seed + 17, protocol.confidenceLevel),
    readinessAuc: bootstrapStatistic(scored, auc, protocol.bootstrapIterations, protocol.seed + 29, protocol.confidenceLevel),
    meanDirectionalReturnBps: bootstrapMean(approvedRows.flatMap((row) => row.directionalReturnBps === null ? [] : [row.directionalReturnBps]), protocol.bootstrapIterations, protocol.seed, protocol.confidenceLevel),
  };
}

export function thresholdCurve(rows: readonly ValidationOpportunity[], protocol: EngineValidationProtocol): ThresholdResult[] {
  return protocol.readinessThresholds.map((threshold) => {
    const metrics = classificationMetrics(rows, protocol, (row) => row.readinessPercent !== null && row.readinessPercent >= threshold);
    const objective = metrics.coverage.estimate < protocol.minimumThresholdCoverage ? null : metrics.balancedAccuracy;
    return { threshold, metrics, objective };
  });
}

export function selectThreshold(curve: readonly ThresholdResult[]): number | null {
  const eligible = curve.filter((item) => item.objective !== null);
  if (!eligible.length) return null;
  return [...eligible].sort((a, b) => b.objective! - a.objective! || b.metrics.meanDirectionalReturnBps?.estimate! - a.metrics.meanDirectionalReturnBps?.estimate! || a.threshold - b.threshold)[0]!.threshold;
}

export function readinessBuckets(rows: readonly ValidationOpportunity[], protocol: EngineValidationProtocol): ReadinessBucket[] {
  const buckets: ReadinessBucket[] = [];
  for (let minimum = 0; minimum < 100; minimum += 10) {
    const maximum = minimum + 10, selected = rows.filter((row) => row.readinessPercent !== null && row.readinessPercent >= minimum && (maximum === 100 ? row.readinessPercent <= maximum : row.readinessPercent < maximum));
    const successful = selected.filter((row) => row.successful !== null), wins = successful.filter((row) => row.successful).length;
    buckets.push({ minimum, maximum, sampleSize: selected.length, approved: selected.filter((row) => row.approved).length, successRate: successful.length ? wilsonInterval(wins, successful.length, protocol.confidenceLevel) : null, meanDirectionalReturnBps: bootstrapMean(selected.flatMap((row) => row.directionalReturnBps === null ? [] : [row.directionalReturnBps]), protocol.bootstrapIterations, protocol.seed + minimum, protocol.confidenceLevel) });
  }
  return buckets;
}
