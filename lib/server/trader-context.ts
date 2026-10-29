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

import { generateTraderCompanion } from "./trader-companion.ts";
import { buildIntegralIntelligence, normalizeRecordedResult, type IntegralTrade } from "../trader-integral-intelligence.ts";

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
  const [profile, trades, memories, feedback, decisions, intelligenceProfile, openTrades, settings, responses, scans, accounts, experiments, collective] = await Promise.all([
    dataClient
      .from("profiles")
      .select("display_name,experience_level,trader_type,preferred_locale")
      .eq("id", userId)
      .maybeSingle(),
    dataClient
      .from("active_trades")
      .select(
        "id,user_id,status,instrument,direction,risk_percent,initial_rr,setup_type,strategy_profile_id,strategy_name_at_entry,outcome,result_r,opened_at,closed_at,taken_against_verdict,strategy_snapshot,account_id,risk_amount,realized_pnl,fees,mfe_r,last_price_at,last_analysis",
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
      .select("timezone,daily_brief,locale")
      .eq("user_id", userId)
      .maybeSingle(),
    dataClient.from("active_trades").select("id,user_id,status,instrument,direction,risk_percent,account_id,opened_at,last_price_at,current_r,last_analysis,strategy_snapshot").eq("user_id",userId).eq("status","OPEN").limit(100),
    dataClient.from("trader_intelligence_settings").select("collective_opt_in,muted_keys").eq("user_id",userId).maybeSingle(),
    dataClient.from("trader_intelligence_interventions").select("intervention_key,response,responded_at").eq("user_id",userId).not("response","is",null).order("responded_at",{ascending:false}).limit(100),
    dataClient.from("market_scans").select("id,user_id,instrument,analysis").eq("user_id",userId).eq("server_created",true).order("created_at",{ascending:false}).limit(12),
    dataClient.from("trading_accounts").select("id,user_id,name,currency,current_balance,peak_balance").eq("user_id",userId).eq("is_archived",false).limit(100),
    dataClient.from("trader_intelligence_experiments").select("id,hypothesis,started_at,timezone,baseline_ids,status,outcome").eq("user_id",userId).order("started_at",{ascending:false}).limit(10),
    dataClient.from("trader_collective_patterns").select("dimension,bucket,trades,contributor_count,average_r").gte("contributor_count",20).gte("trades",100).order("trades",{ascending:false}).limit(100),
  ]);
  for (const result of [profile, trades, memories, feedback, decisions, openTrades, settings, responses, scans, accounts, experiments, collective])
    if (result.error) throw result.error;
  if (intelligenceProfile.error && intelligenceProfile.error.code !== "PGRST116")
    throw intelligenceProfile.error;
  const records = (trades.data ?? []).map((row) => normalizeRecordedResult({
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
  summary.integral = buildIntegralIntelligence({ userId, summary,
    trades: [...records, ...(openTrades.data ?? []).map(row => ({...row,source:"EXECUTED"}))] as IntegralTrade[],
    memories: memories.data ?? [], responses: responses.data ?? [], scans:scans.data??[], accounts:accounts.data??[], experiments:experiments.data??[], collective:collective.data??[],
    settings: { collectiveOptIn: settings.data?.collective_opt_in === true, mutedKeys: settings.data?.muted_keys ?? [] },
  });
  for (const experiment of summary.integral.experiments) if (experiment.status === "ACTIVE" && experiment.evaluation.status === "EVALUATED") {
    const update = await dataClient.from("trader_intelligence_experiments").update({status:"EVALUATED",outcome:experiment.evaluation,evaluated_at:summary.generatedAt}).eq("user_id",userId).eq("id",experiment.id).eq("status","ACTIVE");
    if (update.error) throw update.error;
    experiment.status = "EVALUATED";
  }
  const priorBrief = intelligenceProfile.data?.daily_brief;
  if (priorBrief?.generatedAt && priorBrief?.message && ["OPENAI","DETERMINISTIC"].includes(priorBrief.source)) summary.integral.brief = priorBrief;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ ...summary, generatedAt: undefined, integral: {...summary.integral,generatedAt:undefined} }))
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
    source: "Recorded closed executions: net realized P&L / recorded risk where available; otherwise recorded R with unknown fee impact.",
    evidenceIds: finding.evidenceIds,
  }));
  facts.push({ id: "integral:state", text: JSON.stringify(summary.integral),
    source: "Recorded personal intelligence. Market observations apply only to their instrument, strategy, timeframe and timestamp. Measured correlation, broker verification and causal benefit are unavailable. No automatic strategy or order changes." });
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
    profile: profile.data ? {...profile.data,preferred_locale:["en","es","fr"].includes(profile.data.preferred_locale)?profile.data.preferred_locale:intelligenceProfile.data?.locale??"en"} : null,
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
    const localDay = new Intl.DateTimeFormat("en-CA", {timeZone:context.summary.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(context.summary.generatedAt));
    const claim = context.summary.integral && context.summary.integral.brief?.day !== localDay
      ? await createAdminClient().rpc("claim_trader_daily_brief",{p_user_id:userId,p_day:localDay}) : null;
    if (claim?.error) throw claim.error;
    if (context.summary.integral && claim?.data === true) {
      const output = await generateTraderCompanion({ facts: context.facts, profile: context.profile,
        message: "Prepare an automatic daily process brief: one priority from recorded evidence, what changed, one concrete review task. Do not ask for a trade or issue an execution instruction. Distinguish declared preferences, observations and unavailable information. Do not infer a current market regime. Cite supplied facts.",
        history: [], locale: context.profile?.preferred_locale ?? "en", memorySaved: false });
      const brief = {day:localDay,generatedAt:context.summary.generatedAt,...output.reply,source:output.source,failureCode:output.failureCode};
      const stored = await createAdminClient().from("trader_intelligence_profiles").upsert({user_id:userId,daily_brief:brief},{onConflict:"user_id"});
      if (stored.error) throw stored.error;
      context.summary.integral.brief = brief;
      const snapshot = await createAdminClient().from("trader_learning_snapshots").update({summary:context.summary,updated_at:context.summary.generatedAt}).eq("user_id",userId);
      if (snapshot.error) throw snapshot.error;
    }
    await createAdminClient()
      .from("trader_intelligence_profiles")
      .upsert({
        user_id: userId,
        last_intraday_refresh_at: context.summary.generatedAt,
        learning_state: {
          closedTrades: context.summary.closedTrades,
          averageR: context.summary.averageR,
          behavior: context.summary.behavior,
          priorityRecommendation: context.summary.recommendations[0]?.id ?? null,
          generatedAt: context.summary.generatedAt,
        },
      }, { onConflict: "user_id" });
    return { updated: true, closedTrades: context.summary.closedTrades };
  } catch {
    console.warn("[TRADER_LEARNING_REFRESH_FAILED]");
    return { updated: false };
  }
}
