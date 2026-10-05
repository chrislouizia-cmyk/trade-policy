import { isTradeLifecycleSimulationRecord } from "./trade-lifecycle-v2-core.ts";

export type LearningTrade = {
  id: string;
  user_id: string;
  source: string;
  status: string;
  instrument: string;
  session?: string | null;
  strategy_profile_id?: string | null;
  outcome?: string | null;
  result_r?: number | string | null;
  closed_at?: string | null;
  post_analysis?: Record<string, unknown> | null;
  rule_snapshot?: Record<string, unknown> | null;
};
export type LearningExecution = {
  trade_record_id?: string | null;
  strategy_snapshot?: Record<string, unknown> | null;
  simulation_mode?: string | null;
  source?: string | null;
  taken_against_verdict?: boolean | null;
};
export type LearningFinding = {
  id: string;
  kind: "HISTORY" | "DISCIPLINE" | "FEEDBACK";
  text: string;
  evidenceIds: string[];
  sampleSize: number;
};
export type LearningSummary = {
  version: "1";
  closedTrades: number;
  excludedTrades: number;
  averageR: number | null;
  findings: LearningFinding[];
  evidenceIds: string[];
  generatedAt: string;
};

// Descriptive observations only: outcomes never establish causality or rewrite a rule.
export function buildTraderLearning(
  userId: string,
  trades: LearningTrade[],
  executions: LearningExecution[],
  now = new Date(),
): LearningSummary {
  const executionByRecord = new Map(
    executions
      .filter((row) => row.trade_record_id)
      .map((row) => [row.trade_record_id!, row]),
  );
  const ownTrades = [
    ...new Map(
      trades
        .filter((row) => row.user_id === userId)
        .map((row) => [row.id, row]),
    ).values(),
  ];
  const valid = ownTrades.filter((row) => {
    const execution = executionByRecord.get(row.id);
    return (
      row.user_id === userId &&
      row.source === "EXECUTED" &&
      row.status === "CLOSED" &&
      Boolean(row.closed_at) &&
      row.result_r != null &&
      String(row.result_r).trim() !== "" &&
      Number.isFinite(Number(row.result_r)) &&
      !isTradeLifecycleSimulationRecord(execution) &&
      !isTradeLifecycleSimulationRecord({
        strategy_snapshot: row.post_analysis,
        source: row.source,
      }) &&
      !isTradeLifecycleSimulationRecord({
        strategy_snapshot: row.rule_snapshot,
      }) &&
      ![
        execution?.strategy_snapshot,
        row.post_analysis,
        row.rule_snapshot,
      ].some((snapshot) => snapshot?.internalTestMode === true)
    );
  });
  const average = (rows: LearningTrade[]) =>
    Math.round(
      (rows.reduce((sum, row) => sum + Number(row.result_r), 0) / rows.length) *
        1000,
    ) / 1000;
  const findings: LearningFinding[] = [];
  if (valid.length)
    findings.push({
      id: "history:all",
      kind: "HISTORY",
      text: `Within the supplied recent records: ${valid.length} recorded closed executions; observed average ${average(valid)} R. These are recorded outcomes, not broker-verified results or a forecast.`,
      evidenceIds: valid.map((row) => row.id),
      sampleSize: valid.length,
    });
  for (const field of [
    "instrument",
    "session",
    "strategy_profile_id",
  ] as const) {
    const groups = new Map<string, LearningTrade[]>();
    for (const row of valid) {
      const key = row[field];
      if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [key, rows] of groups) {
      if (rows.length < 3) continue;
      findings.push({
        id: `history:${field}:${key}`,
        kind: "HISTORY",
        text: `${field} ${key}: ${rows.length} recorded executions, observed average ${average(rows)} R. ${rows.length < 30 ? "Small sample; no reliable conclusion about an edge." : "Descriptive sample; validate any proposed change on separate data."}`,
        evidenceIds: rows.map((row) => row.id),
        sampleSize: rows.length,
      });
    }
  }
  const overrides = valid.filter(
    (row) => executionByRecord.get(row.id)?.taken_against_verdict === true,
  );
  if (overrides.length)
    findings.push({
      id: "discipline:overrides",
      kind: "DISCIPLINE",
      text: `${overrides.length} of ${valid.length} recorded closed executions were taken against the original verdict. This records a rule override, not an inferred emotion.`,
      evidenceIds: overrides.map((row) => row.id),
      sampleSize: overrides.length,
    });
  return {
    version: "1",
    closedTrades: valid.length,
    excludedTrades: ownTrades.length - valid.length,
    averageR: valid.length ? average(valid) : null,
    findings: findings.slice(0, 25),
    evidenceIds: valid.map((row) => row.id),
    generatedAt: now.toISOString(),
  };
}

export type CompanionFact = {
  id: string;
  text: string;
  source: string;
  evidenceIds?: string[];
};
export type CompanionResponse = {
  message: string;
  question: string;
  evidenceIds: string[];
};
export function validateCompanionResponse(
  candidate: CompanionResponse,
  facts: CompanionFact[],
): boolean {
  const known = new Set(facts.map((fact) => fact.id));
  const text = `${candidate.message} ${candidate.question}`;
  // This layer cannot issue an execution command, override the motor or promise outcomes.
  const prohibited =
    /\b(?:buy|sell|enter|exit|close|open|place|move|increase|reduce)\s+(?:now|the\s+(?:trade|position|stop)|your\s+(?:trade|position|stop|risk))|\b(?:compra|vende|entra|cierra|abre|mueve|aumenta)\s+(?:ahora|la\s+(?:operaci[oó]n|posici[oó]n)|tu\s+(?:stop|riesgo))|guaranteed (?:profit|return|win)|guarantee (?:a |your |the )?(?:profit|return|win)|ganancias? garantizadas?|garantiz(?:o|a|amos) (?:una? |el |tu )?(?:ganancia|beneficio|resultado)|profit probability\s*(?:is|:|=)|probabilidad de ganancia\s*(?:es|:|=)|gains? garantis|rendement garanti|(?:achetez|vendez|ouvrez|fermez|augmentez|déplacez)\s+(?:maintenant|votre (?:stop|risque))|ignore (?:your|the) rules|ignora (?:tus|las) reglas/i;
  return (
    candidate.message.length > 0 &&
    candidate.message.length <= 2400 &&
    candidate.question.length <= 400 &&
    candidate.evidenceIds.every((id) => known.has(id)) &&
    !/[<>]/.test(text) &&
    !prohibited.test(text)
  );
}
