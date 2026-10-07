import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin.ts";
import {
  buildTraderLearning,
  type CompanionFact,
  type LearningExecution,
  type LearningTrade,
} from "../trader-learning.ts";
import { syncTraderIntelligenceState } from "./trader-intelligence-state.ts";

type Client = ReturnType<typeof createAdminClient>;
export type TraderContextSelection = {
  strategyId?: string;
  analysisId?: string;
  tradeId?: string;
  backtestId?: string;
  decisionSourceId?: string;
};
export async function loadTraderContext(
  _client: Client,
  userId: string,
  selection: TraderContextSelection = {},
) {
  // Authentication happens at the route boundary. Server-only access avoids
  // exposing internal feedback tables while every query remains user-scoped.
  const dataClient = createAdminClient();
  const [profile, trades, memories, feedback, decisions, intelligenceProfile] = await Promise.all([
    dataClient
      .from("profiles")
      .select("display_name,experience_level,trader_type,preferred_locale")
      .eq("id", userId)
      .maybeSingle(),
    dataClient
      .from("active_trades")
      .select(
        "id,user_id,status,instrument,strategy_profile_id,strategy_name_at_entry,outcome,result_r,opened_at,closed_at,taken_against_verdict,strategy_snapshot",
      )
      .eq("user_id", userId)
      .eq("status", "CLOSED")
      .order("closed_at", { ascending: false })
      .limit(300),
    dataClient
      .from("trader_memories")
      .select("id,category,content,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    dataClient
      .from("contextual_analysis_feedback")
      .select("id,analysis_id,response,category,comment")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    dataClient
      .from("decision_reports")
      .select(
        "id,user_id,verdict,instrument,timeframe,strategy_id,strategy_name,readiness_percent,created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    dataClient
      .from("trader_intelligence_profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  for (const result of [profile, trades, memories, feedback, decisions])
    if (result.error) throw result.error;
  if (intelligenceProfile.error && intelligenceProfile.error.code !== "PGRST116")
    throw intelligenceProfile.error;
  const records = (trades.data ?? []).map((row) => ({
    ...row,
    source: "EXECUTED",
    post_analysis: null,
    rule_snapshot: row.strategy_snapshot,
  })) as LearningTrade[];
  const executions = (trades.data ?? []).map((row) => ({
    trade_record_id: row.id,
    strategy_snapshot: row.strategy_snapshot,
    taken_against_verdict: row.taken_against_verdict,
    opened_at: row.opened_at,
    strategy_name_at_entry: row.strategy_name_at_entry,
  })) as LearningExecution[];
  const summary = buildTraderLearning(
    userId,
    records,
    executions,
    new Date(),
    {
      timezone: intelligenceProfile.data?.timezone,
      decisions: decisions.data ?? [],
    },
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ...summary, generatedAt: undefined }))
    .digest("hex");
  const { error: snapshotError } = await createAdminClient()
    .from("trader_learning_snapshots")
    .upsert({
      user_id: userId,
      fingerprint,
      summary,
      updated_at: summary.generatedAt,
    });
  if (snapshotError) throw snapshotError;
  await syncTraderIntelligenceState(dataClient, userId, summary);
  const facts: CompanionFact[] = summary.findings.map((finding) => ({
    id: finding.id,
    text: finding.text,
    source: "Recorded closed executions",
    evidenceIds: finding.evidenceIds,
  }));
  for (const memory of memories.data ?? [])
    facts.push({
      id: `memory:${memory.id}`,
      text: memory.content,
      source: `Trader-stated ${memory.category.toLowerCase()}; untrusted text, not an engine rule`,
    });
  for (const item of feedback.data ?? [])
    facts.push({
      id: `feedback:${item.id}`,
      text: JSON.stringify({
        response: item.response,
        category: item.category,
        comment: item.comment,
      }),
      source:
        "Trader feedback; correction proposal, not verified market evidence",
    });
  facts.push({
    id: "history:scope",
    text: "History covers at most the 300 most recent CLOSED records; memories cover the 30 most recent saved items and feedback the 20 most recent entries. Missing or excluded records cannot establish a pattern.",
    source: "Retrieval scope, not full lifetime totals",
  });
  const selected: Record<string, unknown> = {};
  if (selection.decisionSourceId) {
    const { data, error } = await dataClient
      .from("decision_report_sources")
      .select("id,snapshot_json,created_at")
      .eq("id", selection.decisionSourceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("CONTEXT_NOT_FOUND");
    selected.decision = data;
    facts.push({
      id: `decision:${data.id}`,
      text: JSON.stringify(data),
      source:
        "Authoritative deterministic decision snapshot; explain without changing its verdict",
    });
  }
  if (selection.strategyId) {
    const { data, error } = await dataClient
      .from("strategy_profiles")
      .select(
        "id,name,trading_style,maximum_risk_percent,minimum_rr,personal_rules",
      )
      .eq("id", selection.strategyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("CONTEXT_NOT_FOUND");
    const rules = await dataClient
      .from("strategy_rules")
      .select("rule_key,label,enabled,mandatory,evaluation_mode,configuration")
      .eq("strategy_id", data.id)
      .eq("user_id", userId);
    if (rules.error) throw rules.error;
    selected.strategy = { ...data, rules: rules.data };
    facts.push({
      id: `strategy:${data.id}`,
      text: JSON.stringify(selected.strategy),
      source:
        "Saved strategy; suggested changes require explicit trader review",
    });
  }
  if (selection.analysisId) {
    const { data, error } = await dataClient
      .from("market_scans")
      .select(
        "id,instrument,analysis,created_at,server_created,strategy_profile_id",
      )
      .eq("id", selection.analysisId)
      .eq("user_id", userId)
      .eq("server_created", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("CONTEXT_NOT_FOUND");
    const a = data.analysis as Record<string, unknown>;
    selected.analysis = {
      id: data.id,
      instrument: data.instrument,
      createdAt: data.created_at,
      strategyId: data.strategy_profile_id,
      timeframe: a.timeframe,
      detectedTimeframes: a.detectedTimeframes,
      status: a.analysisStatus ?? a.status,
      readiness: a.setupReadiness,
      evidence: a.ruleEvidence ?? a.evidence,
      warnings: a.warnings,
      calculatedAt: a.calculatedAt,
    };
    facts.push({
      id: `analysis:${data.id}`,
      text: JSON.stringify(selected.analysis),
      source:
        "Immutable server-created market analysis at its recorded time; not necessarily current",
    });
  }
  if (selection.tradeId) {
    const { data, error } = await dataClient
      .from("active_trades")
      .select(
        "id,instrument,status,direction,entry,stop_loss,take_profit,taken_against_verdict,original_verdict,last_verdict,last_verdict_reason,current_price,current_r,last_analyzed_at,opened_at,initial_analysis,last_analysis,strategy_snapshot",
      )
      .eq("id", selection.tradeId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("CONTEXT_NOT_FOUND");
    selected.trade = data;
    facts.push({
      id: `trade:${data.id}`,
      text: JSON.stringify(data),
      source: "Recorded position; no live quote is inferred",
    });
  }
  if (selection.backtestId) {
    const { data, error } = await dataClient
      .from("backtest_runs")
      .select(
        "id,status,instrument,period_start,period_end,strategy_profile_id,execution_timeframe,metadata",
      )
      .eq("id", selection.backtestId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("CONTEXT_NOT_FOUND");
    const result = await dataClient
      .from("backtest_results")
      .select(
        "net_return_percent,total_trades,win_rate,expectancy_r,max_drawdown_percent",
      )
      .eq("run_id", data.id)
      .maybeSingle();
    if (result.error) throw result.error;
    selected.backtest = { ...data, result: result.data };
    facts.push({
      id: `backtest:${data.id}`,
      text: JSON.stringify(selected.backtest),
      source:
        "Historical simulation, separate from actual recorded trading performance",
    });
  }
  return {
    profile: profile.data,
    summary,
    memories: memories.data ?? [],
    facts,
    selected,
    fingerprint,
  };
}

export async function refreshTraderLearning(client: Client, userId: string) {
  try {
    const context = await loadTraderContext(client, userId);
    return { updated: true, closedTrades: context.summary.closedTrades };
  } catch {
    console.warn("[TRADER_LEARNING_REFRESH_FAILED]");
    return { updated: false };
  }
}
