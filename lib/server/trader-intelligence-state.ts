import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin.ts";
import type { LearningDimension, LearningSummary } from "../trader-learning.ts";
import {
  buildAnonymousContributions,
  buildCollectivePatterns,
  type IntelligenceIntervention,
} from "../trader-intelligence.ts";

type Client = ReturnType<typeof createAdminClient>;

export async function loadTraderLearningSnapshot(userId: string) {
  const result = await createAdminClient()
    .from("trader_learning_snapshots")
    .select("summary")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) {
    console.warn("[TRADER_INTELLIGENCE_SNAPSHOT_READ_FAILED]");
    return null;
  }
  return (result.data?.summary ?? null) as LearningSummary | null;
}

export async function syncTraderIntelligenceState(
  client: Client,
  userId: string,
  summary: LearningSummary,
) {
  await Promise.all([
    syncRecommendations(client, userId, summary),
    syncContributions(client, userId, summary),
  ]);
}

export async function recordTraderInterventions(
  userId: string,
  interventions: IntelligenceIntervention[],
  context: Record<string, unknown>,
) {
  if (!interventions.length) return;
  const client = createAdminClient();
  const contextFingerprint = createHash("sha256")
    .update(JSON.stringify(context))
    .digest("hex");
  const result = await client.from("trader_intelligence_interventions").upsert(
    interventions.map((item) => ({
      user_id: userId,
      stage: item.stage,
      severity: item.severity,
      intervention_key: item.key,
      context_fingerprint: contextFingerprint,
      title: item.title,
      detail: item.detail,
      sample_size: item.sampleSize,
      evidence_ids: item.evidenceIds,
      status: "PRESENTED",
      presented_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,intervention_key,context_fingerprint" },
  );
  if (result.error) console.warn("[TRADER_INTELLIGENCE_INTERVENTION_WRITE_FAILED]");
}

export async function rebuildCollectivePatterns(client: Client) {
  const result = await client
    .from("trader_intelligence_contributions")
    .select("user_id,dimension,bucket,trades,wins,total_r");
  if (result.error) throw result.error;
  const patterns = buildCollectivePatterns(
    (result.data ?? []).map((item) => ({
      contributor: item.user_id,
      dimension: item.dimension,
      bucket: item.bucket,
      trades: Number(item.trades),
      wins: Number(item.wins),
      totalR: Number(item.total_r),
    })),
  );
  const updatedAt = new Date().toISOString();
  if (patterns.length) {
    const write = await client.from("trader_collective_patterns").upsert(
      patterns.map((item) => ({
        dimension: item.dimension,
        bucket: item.bucket,
        contributor_count: item.contributorCount,
        trades: item.trades,
        wins: item.wins,
        losses: item.losses,
        total_r: item.totalR,
        average_r: item.averageR,
        win_rate: item.winRate,
        confidence_level: item.confidence,
        updated_at: updatedAt,
      })),
      { onConflict: "dimension,bucket" },
    );
    if (write.error) throw write.error;
  }
  const validKeys = new Set(patterns.map((item) => `${item.dimension}:${item.bucket}`));
  const stored = await client.from("trader_collective_patterns").select("dimension,bucket");
  if (stored.error) throw stored.error;
  for (const item of stored.data ?? []) {
    if (validKeys.has(`${item.dimension}:${item.bucket}`)) continue;
    const removed = await client
      .from("trader_collective_patterns")
      .delete()
      .eq("dimension", item.dimension)
      .eq("bucket", item.bucket);
    if (removed.error) throw removed.error;
  }
  return patterns.length;
}

async function syncRecommendations(
  client: Client,
  userId: string,
  summary: LearningSummary,
) {
  const existing = await client
    .from("trader_intelligence_recommendations")
    .select("id,recommendation_key,version,status,baseline")
    .eq("user_id", userId)
    .order("version", { ascending: false });
  if (existing.error) throw existing.error;
  const rows = existing.data ?? [];
  const activeKeys = new Set(summary.recommendations.map((item) => item.id));
  const now = summary.generatedAt;
  for (const recommendation of summary.recommendations) {
    const current = rows.find(
      (item) => item.recommendation_key === recommendation.id && item.status === "ACTIVE",
    );
    const baseline = recommendationBaseline(summary, recommendation.id);
    if (!current) {
      const latestVersion = rows.find(
        (item) => item.recommendation_key === recommendation.id,
      )?.version ?? 0;
      const created = await client.from("trader_intelligence_recommendations").insert({
        user_id: userId,
        recommendation_key: recommendation.id,
        version: latestVersion + 1,
        category: recommendation.id.split(":")[0].toUpperCase(),
        priority: recommendation.priority,
        title: recommendation.title,
        detail: recommendation.detail,
        evidence_ids: recommendation.evidenceIds,
        baseline,
        status: "ACTIVE",
        delivered_at: now,
      });
      if (created.error) throw created.error;
      continue;
    }
    const prior = current.baseline as { closedTrades?: number; averageR?: number | null; metric?: number | null } | null;
    if (summary.closedTrades >= Number(prior?.closedTrades ?? 0) + 5) {
      const currentMetric = recommendationMetric(summary, recommendation.id);
      const evaluated = await client
        .from("trader_intelligence_recommendations")
        .update({
          status: "EVALUATED",
          evaluated_at: now,
          outcome: {
            closedTrades: summary.closedTrades,
            averageR: summary.averageR,
            metric: currentMetric,
            change: currentMetric == null || prior?.metric == null
              ? null
              : Math.round((currentMetric - prior.metric) * 1000) / 1000,
            interpretation: "Descriptive change after delivery; not causal attribution.",
          },
          updated_at: now,
        })
        .eq("id", current.id);
      if (evaluated.error) throw evaluated.error;
    }
  }
  const staleIds = rows
    .filter((item) => item.status === "ACTIVE" && !activeKeys.has(item.recommendation_key))
    .map((item) => item.id);
  if (staleIds.length) {
    const stale = await client
      .from("trader_intelligence_recommendations")
      .update({ status: "SUPERSEDED", updated_at: now })
      .in("id", staleIds);
    if (stale.error) throw stale.error;
  }
}

async function syncContributions(
  client: Client,
  userId: string,
  summary: LearningSummary,
) {
  const contributions = buildAnonymousContributions(summary);
  if (contributions.length) {
    const result = await client.from("trader_intelligence_contributions").upsert(
      contributions.map((item) => ({
        user_id: userId,
        dimension: item.dimension,
        bucket: item.bucket,
        trades: item.trades,
        wins: item.wins,
        total_r: item.totalR,
        source_fingerprint: createHash("sha256")
          .update(JSON.stringify(item))
          .digest("hex"),
        updated_at: summary.generatedAt,
      })),
      { onConflict: "user_id,dimension,bucket" },
    );
    if (result.error) throw result.error;
  }
  const validKeys = new Set(contributions.map((item) => `${item.dimension}:${item.bucket}`));
  const stored = await client
    .from("trader_intelligence_contributions")
    .select("dimension,bucket")
    .eq("user_id", userId);
  if (stored.error) throw stored.error;
  for (const item of stored.data ?? []) {
    if (validKeys.has(`${item.dimension}:${item.bucket}`)) continue;
    const removed = await client
      .from("trader_intelligence_contributions")
      .delete()
      .eq("user_id", userId)
      .eq("dimension", item.dimension)
      .eq("bucket", item.bucket);
    if (removed.error) throw removed.error;
  }
}

function recommendationBaseline(summary: LearningSummary, key: string) {
  return {
    closedTrades: summary.closedTrades,
    averageR: summary.averageR,
    metric: recommendationMetric(summary, key),
    capturedAt: summary.generatedAt,
  };
}

function recommendationMetric(summary: LearningSummary, key: string) {
  const [, dimension, ...bucketParts] = key.split(":");
  if (!dimension || !bucketParts.length) return summary.averageR;
  const bucket = bucketParts.join(":");
  return summary.dimensions.find(
    (item: LearningDimension) => item.dimension === dimension && item.key === bucket,
  )?.averageR ?? null;
}
