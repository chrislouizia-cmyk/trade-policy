import type { EngineValidationReport, Interval } from './validation-types.ts';

const percent = (value: number | null | undefined): string => value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(2)}%`;
const number = (value: number | null | undefined): string => value === null || value === undefined ? 'N/A' : value.toFixed(2);
const interval = (value: Interval | null): string => value ? `${percent(value.estimate)} (${percent(value.lower)}–${percent(value.upper)})` : 'N/A';
const safe = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ');

export function renderValidationReportMarkdown(report: EngineValidationReport): string {
  const engine = report.holdout.engine, selected = report.holdout.selectedThreshold;
  const thresholdLabels = report.calibration.thresholdCurve.map((row) => row.threshold).join(', ');
  const thresholdValues = report.calibration.thresholdCurve.map((row) => ((row.metrics.successRate?.estimate ?? 0) * 100).toFixed(2)).join(', ');
  const bucketLabels = report.readinessBuckets.map((row) => `"${row.minimum}-${row.maximum}"`).join(', ');
  const bucketValues = report.readinessBuckets.map((row) => ((row.successRate?.estimate ?? 0) * 100).toFixed(2)).join(', ');
  return `# Trade Police Engine Validation Report

**Conclusion:** ${report.conclusion.verdict.replaceAll('_', ' ')}

${report.conclusion.statements.map((item) => `- ${safe(item)}`).join('\n')}

## Provenance

| Field | Value |
|---|---|
| Report ID | ${report.reportId} |
| Experiment ID | ${report.provenance.experimentId} |
| Dataset | ${safe(report.dataset.id)} v${safe(report.dataset.version)} |
| Dataset hash / certification | ${safe(report.dataset.contentHash)} / ${report.dataset.certificationStatus} |
| Market | ${safe(report.dataset.instrument)} / ${safe(report.dataset.timeframe)} |
| Range | ${report.dataset.startAt} — ${report.dataset.endAt} |
| Candles | ${report.dataset.candleCount} |
| Forward horizon | ${report.protocol.horizonCandles} candles |
| Cost/success buffer | ${report.protocol.minimumReturnBps} bps |
| Calibration / holdout | ${(report.protocol.calibrationFraction * 100).toFixed(0)}% / ${((1 - report.protocol.calibrationFraction) * 100).toFixed(0)}% chronological |
| Git commit | ${safe(report.provenance.gitCommitSha)} |
| Pipeline / validation / explainability | ${report.provenance.pipelineVersion} / ${report.provenance.validationFrameworkVersion} / ${report.provenance.explainabilityFrameworkVersion} |
| Decision / readiness / direction policies | ${report.provenance.decisionPolicyVersion} / ${report.provenance.readinessPolicyVersion} / ${report.provenance.directionPolicyVersion} |
| Random seed / configuration hash | ${report.provenance.randomSeed} / ${safe(report.provenance.configurationHash)} |
| Execution | ${report.provenance.executionTimestamp} / ${safe(report.provenance.executionEnvironment.runtime)} ${safe(report.provenance.executionEnvironment.runtimeVersion)} |

## Reproducibility

**Score:** ${report.reproducibility.score}/100 — ${report.reproducibility.fullyReproducible ? 'FULLY REPRODUCIBLE' : 'NOT FULLY REPRODUCIBLE'}

| Criterion | Result | Explanation |
|---|---|---|
${report.reproducibility.criteria.map((item) => `| ${item.id} | ${item.passed ? 'PASS' : 'FAIL'} | ${safe(item.explanation)} |`).join('\n')}

## Holdout performance

| Metric | Result |
|---|---|
| Opportunities | ${engine.evaluableDirections} |
| Approved | ${engine.approved} |
| Coverage | ${interval(engine.coverage)} |
| Approved success rate | ${interval(engine.successRate)} |
| False-positive rate | ${interval(engine.falsePositiveRate)} |
| False-negative rate | ${interval(engine.falseNegativeRate)} |
| Balanced accuracy | ${percent(engine.balancedAccuracy)} |
| Readiness/outcome correlation | ${engine.readinessOutcomeCorrelation ? `${number(engine.readinessOutcomeCorrelation.estimate)} (${number(engine.readinessOutcomeCorrelation.lower)}–${number(engine.readinessOutcomeCorrelation.upper)})` : 'N/A'} |
| Readiness ROC AUC | ${engine.readinessAuc ? `${number(engine.readinessAuc.estimate)} (${number(engine.readinessAuc.lower)}–${number(engine.readinessAuc.upper)})` : 'N/A'} |
| Mean directional return | ${number(engine.meanDirectionalReturnBps?.estimate)} bps (${number(engine.meanDirectionalReturnBps?.lower)}–${number(engine.meanDirectionalReturnBps?.upper)}) |
| Calibration-selected threshold | ${report.calibration.selectedThreshold ?? 'N/A'} |
| Holdout success at selected threshold | ${interval(selected?.metrics.successRate ?? null)} |

## Readiness threshold curve

\`\`\`mermaid
xychart-beta
    title "Calibration success rate by Readiness threshold"
    x-axis [${thresholdLabels}]
    y-axis "Success %" 0 --> 100
    line [${thresholdValues}]
\`\`\`

## Readiness bands

\`\`\`mermaid
xychart-beta
    title "Holdout success rate by Readiness band"
    x-axis [${bucketLabels}]
    y-axis "Success %" 0 --> 100
    bar [${bucketValues}]
\`\`\`

## Baselines

| Baseline | Coverage | Success | Engine advantage (95% CI) |
|---|---:|---:|---:|
${report.baselines.map((item) => `| ${item.id} | ${percent(item.metrics.coverage.estimate)} | ${percent(item.metrics.successRate?.estimate)} | ${item.differenceInSuccessRate ? `${percent(item.differenceInSuccessRate.estimate)} (${percent(item.differenceInSuccessRate.lower)}–${percent(item.differenceInSuccessRate.upper)})` : 'N/A'} |`).join('\n')}

## Detector leave-one-out analysis

| Detector removed | Full success | Ablated success | Success delta | Coverage delta | Interpretation |
|---|---:|---:|---:|---:|---|
${report.detectorContributions.map((item) => `| ${safe(item.detectorId)} | ${percent(item.fullEngineSuccessRate)} | ${percent(item.ablatedSuccessRate)} | ${item.successRateDifference ? `${percent(item.successRateDifference.estimate)} (${percent(item.successRateDifference.lower)}–${percent(item.successRateDifference.upper)})` : 'N/A'} | ${percent(item.coverageDelta)} | ${item.interpretation} |`).join('\n')}

## Systematic failure segments

| Detector state | Observations | Failures | Failure rate (CI) |
|---|---:|---:|---:|
${report.failureSegments.map((item) => `| ${safe(item.key)} | ${item.sampleSize} | ${item.failures} | ${interval(item.failureRate)} |`).join('\n') || '| None | 0 | 0 | N/A |'}

## Engine explainability

${report.explainability.conclusions.map((item) => `- ${safe(item)}`).join('\n')}

### Detector attribution

| Detector | Fired | Influence | False positives | False negatives | Avg confidence weight | Avg readiness contribution | Calibration priority |
|---|---:|---:|---:|---:|---:|---:|---:|
${report.explainability.detectors.map((item) => `| ${safe(item.detectorId)} | ${percent(item.fireRate.estimate)} | ${percent(item.verdictInfluenceRate)} | ${item.falsePositivesWhenFired} | ${item.falseNegativesAttributed} | ${number(item.averageConfidenceEarnedWeight)} | ${number(item.averageReadinessContributionPercent)}% | ${number(item.calibrationPriorityScore)} |`).join('\n')}

### Detector interaction matrix

| Detector A | Detector B | Co-fired | Approved | Success | Lift | Interpretation |
|---|---|---:|---:|---:|---:|---|
${report.explainability.interactionMatrix.map((item) => `| ${safe(item.leftDetectorId)} | ${safe(item.rightDetectorId)} | ${item.coFired} | ${item.approved} | ${interval(item.successRate)} | ${percent(item.liftVersusEngine)} | ${item.interpretation} |`).join('\n') || '| N/A | N/A | 0 | 0 | N/A | N/A | INCONCLUSIVE |'}

### Best detector combinations

| Fired detectors | Occurrences | Approved | Success | Mean directional return |
|---|---:|---:|---:|---:|
${report.explainability.bestCombinations.map((item) => `| ${safe(item.detectorIds.join(' + ') || 'NONE')} | ${item.occurrences} | ${item.approved} | ${interval(item.successRate)} | ${number(item.meanDirectionalReturnBps?.estimate)} bps |`).join('\n') || '| N/A | 0 | 0 | N/A | N/A |'}

### Consistently failing combinations

| Fired detectors | Occurrences | Approved | Success | Mean directional return |
|---|---:|---:|---:|---:|
${report.explainability.failingCombinations.map((item) => `| ${safe(item.detectorIds.join(' + ') || 'NONE')} | ${item.occurrences} | ${item.approved} | ${interval(item.successRate)} | ${number(item.meanDirectionalReturnBps?.estimate)} bps |`).join('\n') || '| N/A | 0 | 0 | N/A | N/A |'}

### Potential detector redundancy

| Detector A | Detector B | Jaccard overlap | Same-state rate | Result |
|---|---|---:|---:|---|
${report.explainability.redundancy.map((item) => `| ${safe(item.leftDetectorId)} | ${safe(item.rightDetectorId)} | ${percent(item.jaccardSimilarity)} | ${percent(item.sameStateRate)} | ${item.interpretation} |`).join('\n') || '| N/A | N/A | N/A | N/A | DISTINCT |'}

### Regime failures

| Regime | Detector | Sample | Failures | Failure rate |
|---|---|---:|---:|---:|
${report.explainability.regimeFailures.map((item) => `| ${safe(item.regime)} | ${safe(item.detectorId)} | ${item.sampleSize} | ${item.failures} | ${interval(item.failureRate)} |`).join('\n') || '| N/A | N/A | 0 | 0 | N/A |'}

### Pipeline timing diagnostics

- Measured opportunities: ${report.explainability.timings.measuredOpportunities}
- Mean total duration: ${number(report.explainability.timings.meanTotalDurationMs)} ms
- Timings are operational diagnostics and are excluded from deterministic report identity and predictive conclusions.

| Stage | Samples | Mean ms | Maximum ms |
|---|---:|---:|---:|
${report.explainability.timings.stages.map((item) => `| ${item.stage} | ${item.samples} | ${number(item.meanMs)} | ${number(item.maximumMs)} |`).join('\n') || '| N/A | 0 | N/A | N/A |'}

### Opportunity decision traces

| Opportunity | Evaluated | Decision | Direction | Readiness | Fired detectors | Blocking detectors | Outcome | Evidence graph | Decision path |
|---|---|---|---|---:|---|---|---|---|---|
${report.explainability.opportunities.map((item) => `| ${item.opportunityId} | ${item.evaluatedAt} | ${item.trace.finalDecisionOutcome ?? 'N/A'} | ${item.trace.finalDirection ?? 'N/A'} (${item.trace.directionSource}) | ${number(item.readinessPercent)}% | ${safe(item.trace.firedDetectorIds.join(', ') || 'NONE')} | ${safe(item.trace.blockingDetectorIds.join(', ') || 'NONE')} | ${item.successful === null ? 'UNKNOWN' : item.successful ? 'WIN' : 'LOSS'} | ${item.trace.evidenceGraph ? `${item.trace.evidenceGraph.graphId} (${item.trace.evidenceGraph.nodes.length} nodes/${item.trace.evidenceGraph.edges.length} edges)` : 'N/A'} | ${safe(item.trace.decisionPath.map((criterion) => `${criterion.criterionId}:${criterion.status}`).join(' → ') || 'N/A')} |`).join('\n') || '| N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A | N/A |'}

## Data quality

- Evaluated candidates: ${report.dataQuality.evaluated}/${report.dataQuality.totalCandidates}
- Missing direction: ${report.dataQuality.missingDirection}
- Pipeline errors: ${report.dataQuality.pipelineErrors}
- Unique warnings: ${report.dataQuality.warnings.length}

## Limitations

${report.conclusion.limitations.map((item) => `- ${safe(item)}`).join('\n')}
`;
}
