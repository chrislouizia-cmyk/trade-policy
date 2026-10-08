export type RecordedOutcome = { id: string; openedAt: string | null; closedAt: string; resultR: number };
export type RecommendationBaseline = {
  capturedAt?: string;
  evidenceIds?: string[];
  metric?: number | null;
};

export function evaluateRecommendationFollowup(
  baseline: RecommendationBaseline | null,
  outcomes: RecordedOutcome[],
  contextIds?: string[],
) {
  // Old baselines cannot prove which records were already known. Rebaseline them.
  if (!baseline?.capturedAt || !baseline.evidenceIds || !Number.isFinite(Date.parse(baseline.capturedAt))) return null;
  const prior = new Set(baseline.evidenceIds);
  const context = contextIds ? new Set(contextIds) : null;
  const unique = new Map(outcomes.map(row => [row.id, row]));
  const subsequent = [...unique.values()].filter(row => !prior.has(row.id) &&
    (!context || context.has(row.id)) && row.openedAt &&
    Date.parse(row.openedAt) > Date.parse(baseline.capturedAt!) &&
    Date.parse(row.closedAt) >= Date.parse(row.openedAt) && Number.isFinite(row.resultR));
  if (subsequent.length < 5) return null;
  const metric = Math.round(subsequent.reduce((sum, row) => sum + row.resultR, 0) / subsequent.length * 1000) / 1000;
  return { subsequentTrades: subsequent.length, evidenceIds: subsequent.map(row => row.id), metric,
    change: baseline.metric == null ? null : Math.round((metric - baseline.metric) * 1000) / 1000,
    interpretation: "Separate outcomes from trades opened after delivery; observational follow-up, not causal attribution or proven benefit." };
}
