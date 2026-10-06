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
};
export type LearningDimension = {
  dimension: "hour" | "weekday" | "instrument" | "session" | "strategy" | "discipline";
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
      const overridden = row.taken_against_verdict === true ||
        executionByRecord.get(row.id)?.taken_against_verdict === true;
      return {
        key: overridden ? "OVERRIDE" : "FOLLOWED_VERDICT",
        label: overridden ? "Taken against verdict" : "Followed verdict",
      };
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
    generatedAt: now.toISOString(),
  };
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
      .filter((item) => item.dimension === dimension && item.trades >= 5)
      .sort((a, b) => a.averageR - b.averageR);
  for (const dimension of ["hour", "weekday", "strategy", "instrument"] as const) {
    const rows = ranked(dimension);
    const worst = rows[0];
    const best = rows.at(-1);
    if (worst && worst.averageR < 0)
      recommendations.push({
        id: `review:${dimension}:${worst.key}`,
        priority: worst.averageR <= -0.5 ? "HIGH" : "MEDIUM",
        title: `Review ${worst.label}`,
        detail: `${worst.trades} recorded trades average ${worst.averageR}R. Review the journal evidence before trading this ${dimension} again; the sample describes history and does not prove causation.`,
        evidenceIds: worst.evidenceIds,
      });
    if (best && best.averageR > 0 && best.key !== worst?.key)
      recommendations.push({
        id: `protect:${dimension}:${best.key}`,
        priority: "MEDIUM",
        title: `Protect what works in ${best.label}`,
        detail: `${best.trades} recorded trades average +${best.averageR}R. Compare its rule adherence with weaker samples before proposing any strategy change.`,
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
    overridden.averageR + 0.25 < followed.averageR
  )
    recommendations.unshift({
      id: "discipline:override-gap",
      priority: "HIGH",
      title: "Pause before overriding the verdict",
      detail: `Overrides average ${overridden.averageR}R versus ${followed.averageR}R when the verdict was followed. Require a written reason before the next override.`,
      evidenceIds: [...overridden.evidenceIds, ...followed.evidenceIds],
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
