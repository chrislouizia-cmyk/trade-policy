import type { LearningDimension, LearningSummary } from "./trader-learning.ts";

export type IntelligenceStage = "PRE_TRADE" | "ACTIVE_TRADE" | "POST_TRADE";
export type IntelligenceSeverity = "INFO" | "CAUTION" | "PAUSE";

export type IntelligenceIntervention = {
  key: string;
  stage: IntelligenceStage;
  severity: IntelligenceSeverity;
  title: string;
  detail: string;
  sampleSize: number;
  evidenceIds: string[];
  authoritative: false;
};

export type InterventionContext = {
  stage: IntelligenceStage;
  at?: Date;
  instrument?: string | null;
  session?: string | null;
  strategyId?: string | null;
  strategyName?: string | null;
  takenAgainstVerdict?: boolean;
};

export type AnonymousContribution = {
  dimension: Exclude<LearningDimension["dimension"], "strategy">;
  bucket: string;
  trades: number;
  wins: number;
  totalR: number;
};

export type CollectiveContribution = AnonymousContribution & {
  contributor: string;
};

export type CollectivePattern = AnonymousContribution & {
  contributorCount: number;
  losses: number;
  winRate: number;
  averageR: number;
  confidence: "OBSERVED" | "ESTABLISHED";
};

const MIN_PERSONAL_SAMPLE = 5;

// Personal intelligence is descriptive context. It cannot authorize a trade or
// modify the deterministic decision engine's READY / WAIT / BLOCKED state.
export function buildTraderInterventions(
  summary: LearningSummary | null | undefined,
  context: InterventionContext,
): IntelligenceIntervention[] {
  if (!summary) return [];
  const at = context.at ?? new Date();
  const matches = new Map<LearningDimension["dimension"], string>();
  const hour = datePart(at, summary.timezone, "hour");
  const weekday = datePart(at, summary.timezone, "weekday");
  if (hour) matches.set("hour", hour.padStart(2, "0"));
  if (weekday) matches.set("weekday", weekday.toLowerCase());
  if (context.instrument) matches.set("instrument", context.instrument);
  if (context.session) matches.set("session", context.session);

  const strategyKeys = new Set(
    [context.strategyId, context.strategyName].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const interventions: IntelligenceIntervention[] = [];
  for (const item of summary.dimensions) {
    if (item.trades < MIN_PERSONAL_SAMPLE || item.averageR >= 0) continue;
    const matchesContext = item.dimension === "strategy"
      ? strategyKeys.has(item.key) || strategyKeys.has(item.label)
      : matches.get(item.dimension) === item.key;
    if (!matchesContext) continue;
    interventions.push({
      key: `${context.stage.toLowerCase()}:${item.dimension}:${item.key}`,
      stage: context.stage,
      severity: item.trades >= 8 && item.averageR <= -0.5 ? "PAUSE" : "CAUTION",
      title: `Personal pattern: ${item.label}`,
      detail: `${item.trades} recorded trades in this context average ${item.averageR}R. Review the evidence before continuing; this history does not prove causation and does not change the strategy verdict.`,
      sampleSize: item.trades,
      evidenceIds: item.evidenceIds,
      authoritative: false,
    });
  }
  if (
    context.takenAgainstVerdict &&
    summary.recommendations.some((item) => item.id === "discipline:override-gap")
  ) {
    const recommendation = summary.recommendations.find(
      (item) => item.id === "discipline:override-gap",
    )!;
    interventions.unshift({
      key: `${context.stage.toLowerCase()}:discipline:override-gap`,
      stage: context.stage,
      severity: "PAUSE",
      title: "Recorded override pattern",
      detail: `${recommendation.detail} This context does not change the current strategy verdict.`,
      sampleSize: recommendation.evidenceIds.length,
      evidenceIds: recommendation.evidenceIds,
      authoritative: false,
    });
  }
  return interventions
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.sampleSize - a.sampleSize)
    .slice(0, 3);
}

// Strategy-level patterns remain private and never enter the collective pool.
export function buildAnonymousContributions(
  summary: LearningSummary,
): AnonymousContribution[] {
  return summary.dimensions
    .filter((item): item is LearningDimension & { dimension: AnonymousContribution["dimension"] } =>
      item.dimension !== "strategy" && item.trades >= MIN_PERSONAL_SAMPLE)
    .map((item) => ({
      dimension: item.dimension,
      bucket: item.key,
      trades: item.trades,
      wins: item.wins,
      totalR: item.totalR,
    }));
}

export function buildCollectivePatterns(
  contributions: CollectiveContribution[],
  privacy = { minContributors: 20, minTrades: 100 },
): CollectivePattern[] {
  const groups = new Map<string, CollectiveContribution[]>();
  for (const item of contributions) {
    const key = `${item.dimension}:${item.bucket}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const patterns: CollectivePattern[] = [];
  for (const rows of groups.values()) {
    const contributorCount = new Set(rows.map((item) => item.contributor)).size;
    const trades = rows.reduce((sum, item) => sum + item.trades, 0);
    if (contributorCount < privacy.minContributors || trades < privacy.minTrades) continue;
    const wins = rows.reduce((sum, item) => sum + item.wins, 0);
    const totalR = Math.round(rows.reduce((sum, item) => sum + item.totalR, 0) * 1000) / 1000;
    patterns.push({
      dimension: rows[0].dimension,
      bucket: rows[0].bucket,
      contributorCount,
      trades,
      wins,
      losses: Math.max(0, trades - wins),
      totalR,
      winRate: Math.round((wins / trades) * 1000) / 10,
      averageR: Math.round((totalR / trades) * 1000) / 1000,
      confidence: contributorCount >= 50 && trades >= 500 ? "ESTABLISHED" : "OBSERVED",
    });
  }
  return patterns.sort((a, b) => b.trades - a.trades);
}

function severityRank(value: IntelligenceSeverity) {
  return value === "PAUSE" ? 2 : value === "CAUTION" ? 1 : 0;
}

function datePart(date: Date, timezone: string, part: "hour" | "weekday") {
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      ...(part === "hour"
        ? { hour: "2-digit", hourCycle: "h23" as const }
        : { weekday: "long" as const }),
    }).formatToParts(date).find((item) => item.type === part)?.value ?? null;
  } catch {
    return null;
  }
}
