import type { RecordedOutcome } from "./trader-recommendation-evaluation.ts";
import { assessPatternEvidence, type PatternEvidence } from "./trader-pattern-evidence.ts";
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
  opened_at?: string | null;
  strategy_name_at_entry?: string | null;
  taken_against_verdict?: boolean | null;
  direction?: string | null;
  risk_percent?: number | string | null;
  initial_rr?: number | string | null;
  setup_type?: string | null;
  strategy_snapshot?: Record<string, unknown> | null;
  post_analysis?: Record<string, unknown> | null;
  rule_snapshot?: Record<string, unknown> | null;
};
export type LearningExecution = {
  trade_record_id?: string | null;
  strategy_snapshot?: Record<string, unknown> | null;
  simulation_mode?: string | null;
  source?: string | null;
  taken_against_verdict?: boolean | null;
  opened_at?: string | null;
  strategy_name_at_entry?: string | null;
};
export type LearningDecision = {
  id: string;
  user_id: string;
  verdict?: string | null;
  instrument?: string | null;
  timeframe?: string | null;
  strategy_id?: string | null;
  strategy_name?: string | null;
  readiness_percent?: number | string | null;
  created_at: string;
};
export type LearningBehavior = {
  decisions: number;
  readyDecisions: number;
  readyRate: number | null;
  activeDays: number;
  mostCheckedInstrument: string | null;
  mostUsedTimeframe: string | null;
  currentLossStreak: number;
  currentWinStreak: number;
  maximumLossStreak: number;
  tradesToday: number;
  followedVerdictTrades: number;
  overrideTrades: number;
  adherenceRate: number | null;
  averageRiskPercent: number | null;
  recentRiskPercent: number | null;
  riskDriftPercent: number | null;
  knownAdherenceTrades: number;
  riskSampleSize: number;
};
export type LearningDimension = {
  evidence?: PatternEvidence;
  dimension: "hour" | "weekday" | "instrument" | "session" | "strategy" | "discipline" | "direction" | "setup" | "trade_number" | "after_outcome";
  key: string;
  label: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  averageR: number;
  totalR: number;
  evidenceIds: string[];
};
export type LearningRecommendation = {
  id: string;
  priority: "HIGH" | "MEDIUM" | "FOUNDATION";
  title: string;
  detail: string;
  evidenceIds: string[];
};
export type LearningFinding = {
  id: string;
  kind: "HISTORY" | "DISCIPLINE" | "FEEDBACK";
  text: string;
  evidenceIds: string[];
  sampleSize: number;
};
export type LearningSummary = {
  version: "2";
  closedTrades: number;
  excludedTrades: number;
  averageR: number | null;
  findings: LearningFinding[];
  evidenceIds: string[];
  timezone: string;
  dimensions: LearningDimension[];
  recommendations: LearningRecommendation[];
  behavior: LearningBehavior;
  outcomes?: RecordedOutcome[];
  quality?: { validRecords: number; invalidRecords: number; missingRisk: number; missingEntryTime: number; unknownAdherence: number; brokerVerified: false };
  generatedAt: string;
};

// Descriptive observations only: outcomes never establish causality or rewrite a rule.
export function buildTraderLearning(
  userId: string,
  trades: LearningTrade[],
  executions: LearningExecution[],
  now = new Date(),
  options: { timezone?: string; decisions?: LearningDecision[] } = {},
): LearningSummary {
  const timezone = validTimezone(options.timezone);
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
    const entryTime = row.opened_at ?? execution?.opened_at;
    return (
      row.user_id === userId &&
      row.source === "EXECUTED" &&
      row.status === "CLOSED" &&
      Boolean(row.closed_at) &&
      Number.isFinite(Date.parse(row.closed_at!)) &&
      Date.parse(row.closed_at!) <= now.getTime() &&
      (!entryTime || (Number.isFinite(Date.parse(entryTime)) && Date.parse(entryTime) <= Date.parse(row.closed_at!))) &&
      row.result_r != null &&
      String(row.result_r).trim() !== "" &&
      Number.isFinite(Number(row.result_r)) &&
      !isTradeLifecycleSimulationRecord(execution) &&
      !isTradeLifecycleSimulationRecord({ strategy_snapshot: row.strategy_snapshot }) &&
      !isTradeLifecycleSimulationRecord({
        strategy_snapshot: row.post_analysis,
        source: row.source,
      }) &&
      !isTradeLifecycleSimulationRecord({
        strategy_snapshot: row.rule_snapshot,
      }) &&
      ![
        execution?.strategy_snapshot,
        row.strategy_snapshot,
        row.post_analysis,
        row.rule_snapshot,
      ].some((snapshot) => snapshot?.internalTestMode === true)
    );
  });
  // Resolve execution metadata once so every metric uses the same recorded facts.
  for (let i = 0; i < valid.length; i++) {
    const row = valid[i];
    const execution = executionByRecord.get(row.id);
    valid[i] = { ...row, opened_at: row.opened_at ?? execution?.opened_at,
      taken_against_verdict: row.taken_against_verdict ?? execution?.taken_against_verdict };
  }
  const average = (rows: LearningTrade[]) =>
    Math.round(
      (rows.reduce((sum, row) => sum + Number(row.result_r), 0) / rows.length) *
        1000,
    ) / 1000;
  const sumR = (rows: LearningTrade[]) =>
    Math.round(rows.reduce((sum, row) => sum + Number(row.result_r), 0) * 1000) /
    1000;
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
  const dimensions: LearningDimension[] = [];
  const addDimension = (
    dimension: LearningDimension["dimension"],
    groups: Map<string, { label: string; rows: LearningTrade[] }>,
  ) => {
    for (const [key, group] of groups) {
      if (group.rows.length < 3) continue;
      const rows = group.rows;
      const wins = rows.filter((row) => Number(row.result_r) > 0).length;
      const losses = rows.filter((row) => Number(row.result_r) < 0).length;
      dimensions.push({
        dimension,
        key,
        label: group.label,
        trades: rows.length,
        wins,
        losses,
        winRate: Math.round((wins / rows.length) * 1000) / 10,
        averageR: average(rows),
        totalR: sumR(rows),
        evidenceIds: rows.map((row) => row.id),
        evidence: assessPatternEvidence(rows, now, timezone),
      });
    }
  };
  const group = (
    rows: LearningTrade[],
    getKey: (row: LearningTrade) => { key: string; label: string } | null,
  ) => {
    const groups = new Map<string, { label: string; rows: LearningTrade[] }>();
    for (const row of rows) {
      const value = getKey(row);
      if (!value) continue;
      const current = groups.get(value.key) ?? { label: value.label, rows: [] };
      current.rows.push(row);
      groups.set(value.key, current);
    }
    return groups;
  };
  addDimension(
    "hour",
    group(valid, (row) => {
      const value = row.opened_at ?? executionByRecord.get(row.id)?.opened_at;
      if (!value) return null;
      const hour = datePart(value, timezone, "hour");
      return hour === null
        ? null
        : { key: hour.padStart(2, "0"), label: `${hour.padStart(2, "0")}:00–${hour.padStart(2, "0")}:59` };
    }),
  );
  addDimension(
    "weekday",
    group(valid, (row) => {
      const value = row.opened_at ?? executionByRecord.get(row.id)?.opened_at;
      if (!value) return null;
      const weekday = datePart(value, timezone, "weekday");
      return weekday ? { key: weekday.toLowerCase(), label: weekday } : null;
    }),
  );
  addDimension(
    "instrument",
    group(valid, (row) => row.instrument ? { key: row.instrument, label: row.instrument } : null),
  );
  addDimension(
    "session",
    group(valid, (row) => row.session ? { key: row.session, label: row.session.replaceAll("_", " ") } : null),
  );
  addDimension(
    "strategy",
    group(valid, (row) => {
      const execution = executionByRecord.get(row.id);
      const label = row.strategy_name_at_entry ?? execution?.strategy_name_at_entry ?? row.strategy_profile_id;
      return label ? { key: row.strategy_profile_id ?? label, label } : null;
    }),
  );
  addDimension(
    "discipline",
    group(valid, (row) => {
      if (typeof row.taken_against_verdict !== "boolean") return null;
      const overridden = row.taken_against_verdict === true ||
        executionByRecord.get(row.id)?.taken_against_verdict === true;
      return {
        key: overridden ? "OVERRIDE" : "FOLLOWED_VERDICT",
        label: overridden ? "Taken against verdict" : "Followed verdict",
      };
    }),
  );
  const chronological = [...valid].sort((a, b) =>
    new Date(a.opened_at ?? a.closed_at ?? 0).getTime() -
    new Date(b.opened_at ?? b.closed_at ?? 0).getTime());
  const tradeNumberById = new Map<string, number>();
  const priorOutcomeById = new Map<string, string>();
  const dayCounts = new Map<string, number>();
  const byClose = [...valid].sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!));
  let closedCursor = 0;
  let priorClosed: LearningTrade | undefined;
  for (const row of chronological) {
    // Missing entry times cannot identify trade order or the outcome known at entry.
    if (!row.opened_at) continue;
    const timestamp = row.opened_at;
    const day = localDateKey(timestamp, timezone);
    if (day) {
      const sequence = (dayCounts.get(day) ?? 0) + 1;
      dayCounts.set(day, sequence);
      tradeNumberById.set(row.id, sequence);
    }
    while (closedCursor < byClose.length && Date.parse(byClose[closedCursor].closed_at!) < Date.parse(timestamp)) {
      priorClosed = byClose[closedCursor++];
    }
    if (priorClosed) priorOutcomeById.set(row.id,
      Number(priorClosed.result_r) > 0 ? "WIN" : Number(priorClosed.result_r) < 0 ? "LOSS" : "BREAKEVEN");
  }
  addDimension(
    "direction",
    group(valid, (row) => row.direction ? { key: row.direction.toUpperCase(), label: row.direction.toUpperCase() } : null),
  );
  addDimension(
    "setup",
    group(valid, (row) => row.setup_type ? { key: row.setup_type, label: row.setup_type } : null),
  );
  addDimension(
    "trade_number",
    group(valid, (row) => {
      const sequence = tradeNumberById.get(row.id);
      return sequence ? { key: String(sequence), label: `Trade ${sequence} of the day` } : null;
    }),
  );
  addDimension(
    "after_outcome",
    group(valid, (row) => {
      const outcome = priorOutcomeById.get(row.id);
      return outcome ? { key: outcome, label: `After a ${outcome.toLowerCase()}` } : null;
    }),
  );
  const ownDecisions = (options.decisions ?? []).filter(
    (row) => row.user_id === userId,
  );
  const readyDecisions = ownDecisions.filter((row) =>
    ["READY", "AUTHORIZED", "PASS"].includes(String(row.verdict).toUpperCase()),
  ).length;
  const activeDays = new Set(
    ownDecisions.map((row) => localDateKey(row.created_at, timezone)).filter(Boolean),
  ).size;
  const mostFrequent = (values: Array<string | null | undefined>) => {
    const counts = new Map<string, number>();
    for (const value of values)
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const behavior: LearningBehavior = {
    decisions: ownDecisions.length,
    readyDecisions,
    readyRate: ownDecisions.length
      ? Math.round((readyDecisions / ownDecisions.length) * 1000) / 10
      : null,
    activeDays,
    mostCheckedInstrument: mostFrequent(ownDecisions.map((row) => row.instrument)),
    mostUsedTimeframe: mostFrequent(ownDecisions.map((row) => row.timeframe)),
    ...buildBehaviorProfile(valid, [...valid].sort((a, b) => Date.parse(a.closed_at!) - Date.parse(b.closed_at!)), timezone, now),
  };
  const recommendations = buildRecommendations(valid, dimensions);
  return {
    version: "2",
    closedTrades: valid.length,
    excludedTrades: ownTrades.length - valid.length,
    averageR: valid.length ? average(valid) : null,
    findings: findings.slice(0, 25),
    evidenceIds: valid.map((row) => row.id),
    timezone,
    dimensions,
    recommendations,
    behavior,
    outcomes: valid.map(row => ({ id: row.id, openedAt: row.opened_at ?? null, closedAt: row.closed_at!, resultR: Number(row.result_r) })),
    quality: { validRecords: valid.length, invalidRecords: ownTrades.length - valid.length,
      missingRisk: valid.filter(row => positiveRisk(row.risk_percent) === null).length,
      missingEntryTime: valid.filter(row => !row.opened_at).length,
      unknownAdherence: valid.filter(row => typeof row.taken_against_verdict !== "boolean").length,
      brokerVerified: false },
    generatedAt: now.toISOString(),
  };
}

function buildBehaviorProfile(
  valid: LearningTrade[],
  chronological: LearningTrade[],
  timezone: string,
  now: Date,
): Pick<LearningBehavior,
  "currentLossStreak" | "currentWinStreak" | "maximumLossStreak" | "tradesToday" |
  "followedVerdictTrades" | "overrideTrades" | "adherenceRate" |
  "averageRiskPercent" | "recentRiskPercent" | "riskDriftPercent" | "knownAdherenceTrades" | "riskSampleSize"> {
  let maximumLossStreak = 0;
  let runningLosses = 0;
  for (const row of chronological) {
    if (Number(row.result_r) < 0) {
      runningLosses += 1;
      maximumLossStreak = Math.max(maximumLossStreak, runningLosses);
    } else {
      runningLosses = 0;
    }
  }
  let currentLossStreak = 0;
  let currentWinStreak = 0;
  for (const row of [...chronological].reverse()) {
    const result = Number(row.result_r);
    if (result < 0 && currentWinStreak === 0) currentLossStreak += 1;
    else if (result > 0 && currentLossStreak === 0) currentWinStreak += 1;
    else break;
  }
  const overrideTrades = valid.filter((row) => row.taken_against_verdict === true).length;
  const followedVerdictTrades = valid.filter(row => row.taken_against_verdict === false).length;
  const knownAdherenceTrades = followedVerdictTrades + overrideTrades;
  const risks = valid.map((row) => positiveRisk(row.risk_percent)).filter((value): value is number => value !== null);
  const recentRisks = chronological.slice(-5).map((row) => positiveRisk(row.risk_percent)).filter((value): value is number => value !== null);
  const mean = (values: number[]) => values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    : null;
  const averageRiskPercent = mean(risks);
  const recentRiskPercent = mean(recentRisks);
  return {
    currentLossStreak,
    currentWinStreak,
    maximumLossStreak,
    tradesToday: valid.filter((row) => {
      const timestamp = row.opened_at ?? row.closed_at;
      return timestamp && localDateKey(timestamp, timezone) === localDateKey(now.toISOString(), timezone);
    }).length,
    followedVerdictTrades,
    overrideTrades,
    knownAdherenceTrades,
    riskSampleSize: risks.length,
    adherenceRate: knownAdherenceTrades ? Math.round((followedVerdictTrades / knownAdherenceTrades) * 1000) / 10 : null,
    averageRiskPercent,
    recentRiskPercent,
    riskDriftPercent: averageRiskPercent != null && recentRiskPercent != null
      ? Math.round((recentRiskPercent - averageRiskPercent) * 1000) / 1000
      : null,
  };
}

function positiveRisk(value: LearningTrade["risk_percent"]): number | null {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 100 ? number : null;
}

function validTimezone(value?: string) {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

function datePart(
  value: string,
  timezone: string,
  part: "hour" | "weekday",
) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...(part === "hour"
      ? { hour: "2-digit", hourCycle: "h23" as const }
      : { weekday: "long" as const }),
  });
  return formatter.formatToParts(date).find((item) => item.type === part)?.value ?? null;
}

function localDateKey(value: string, timezone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildRecommendations(
  trades: LearningTrade[],
  dimensions: LearningDimension[],
): LearningRecommendation[] {
  if (trades.length < 5)
    return [{
      id: "foundation:sample",
      priority: "FOUNDATION",
      title: "Build the evidence base",
      detail: `Record ${5 - trades.length} more closed execution${5 - trades.length === 1 ? "" : "s"} before using personal patterns for coaching.`,
      evidenceIds: trades.map((row) => row.id),
    }];
  const recommendations: LearningRecommendation[] = [];
  const ranked = (dimension: LearningDimension["dimension"]) =>
    dimensions
      .filter((item) => item.dimension === dimension && item.trades >= 5 && item.evidence?.status !== "STALE" && item.evidence?.status !== "CONFLICTING")
      .sort((a, b) => a.averageR - b.averageR);
  for (const dimension of ["hour", "weekday", "strategy", "instrument", "trade_number", "after_outcome", "direction", "setup"] as const) {
    const rows = ranked(dimension);
    const worst = rows[0];
    const best = rows.at(-1);
    if (worst && worst.averageR < 0)
      recommendations.push({
        id: `review:${dimension}:${worst.key}`,
        priority: worst.evidence?.status === "REPEATED" && worst.averageR <= -0.5 ? "HIGH" : "MEDIUM",
        title: `Review ${worst.label}`,
        detail: `${worst.trades} recorded trades average ${worst.averageR}R. Review the journal evidence before trading this ${dimension} again; the sample describes history and does not prove causation.`,
        evidenceIds: worst.evidenceIds,
      });
    if (best && best.averageR > 0 && best.key !== worst?.key)
      recommendations.push({
        id: `protect:${dimension}:${best.key}`,
        priority: "MEDIUM",
        title: `Review the positive observation in ${best.label}`,
        detail: `${best.trades} recorded trades average +${best.averageR}R. ${best.evidence?.status === "REPEATED" ? "The direction repeats across two time-ordered samples; this does not establish an edge." : "Early observation; collect later evidence before adapting."} Compare its rule adherence with weaker samples before proposing any strategy change.`,
        evidenceIds: best.evidenceIds,
      });
  }
  const followed = dimensions.find(
    (item) => item.dimension === "discipline" && item.key === "FOLLOWED_VERDICT",
  );
  const overridden = dimensions.find(
    (item) => item.dimension === "discipline" && item.key === "OVERRIDE",
  );
  if (
    followed &&
    overridden &&
    followed.trades >= 5 && overridden.trades >= 5 &&
    followed.evidence?.status !== "STALE" && overridden.evidence?.status !== "STALE" &&
    followed.evidence?.status !== "CONFLICTING" && overridden.evidence?.status !== "CONFLICTING" &&
    overridden.averageR + 0.25 < followed.averageR
  )
    recommendations.unshift({
      id: "discipline:override-gap",
      priority: "HIGH",
      title: "Pause before overriding the verdict",
      detail: `Overrides average ${overridden.averageR}R versus ${followed.averageR}R when the verdict was followed. Require a written reason before the next override.`,
      evidenceIds: [...overridden.evidenceIds, ...followed.evidenceIds],
    });
  const chronological = [...trades].sort((a, b) =>
    new Date(a.closed_at ?? a.opened_at ?? 0).getTime() -
    new Date(b.closed_at ?? b.opened_at ?? 0).getTime());
  let lossStreak = 0;
  for (const row of chronological.reverse()) {
    if (Number(row.result_r) < 0) lossStreak += 1;
    else break;
  }
  if (lossStreak >= 3)
    recommendations.unshift({
      id: "discipline:loss-streak",
      priority: "HIGH",
      title: "Investigate the current loss streak",
      detail: `${lossStreak} consecutive recorded losses require a structured review of execution, market context and rule adherence before increasing exposure. Your saved constitutional limit remains authoritative.`,
      evidenceIds: chronological.slice(0, lossStreak).map((row) => row.id),
    });
  return recommendations.slice(0, 6);
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
