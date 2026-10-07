import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "../supabase/admin.ts";

export type TraderIntelligenceEventType =
  | "ACCOUNT_SEEN"
  | "PAGE_VIEW"
  | "DECISION_STARTED"
  | "DECISION_CREATED"
  | "VERDICT_OVERRIDDEN"
  | "TRADE_OPENED"
  | "TRADE_REANALYZED"
  | "TRADE_CLOSED"
  | "INTERVENTION_PRESENTED"
  | "INTERVENTION_RESPONDED"
  | "RECOMMENDATION_EVALUATED"
  | "FEEDBACK_SAVED"
  | "BACKTEST_COMPLETED";

type EventInput = {
  userId: string;
  eventType: TraderIntelligenceEventType;
  route?: string | null;
  context?: Record<string, unknown>;
  dedupeKey?: string | null;
  occurredAt?: string;
};

const contextKeys = new Set([
  "analysisId", "sourceId", "reportId", "tradeId", "strategyId",
  "instrument", "direction", "session", "timeframe", "setupType",
  "verdict", "activationMode", "takenAgainstVerdict", "riskPercent",
  "initialRR", "currentR", "resultR", "outcome", "interventionKey",
  "recommendationKey", "response", "status", "stage", "severity",
]);

function safeContext(input: Record<string, unknown> = {}) {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!contextKeys.has(key)) continue;
    if (typeof value === "string") output[key] = value.slice(0, 160);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "boolean" || value === null) output[key] = value;
  }
  return output;
}

export async function recordTraderIntelligenceEvent(input: EventInput) {
  const admin = createAdminClient();
  const now = input.occurredAt ?? new Date().toISOString();
  const dedupeKey = input.dedupeKey
    ? createHash("sha256").update(input.dedupeKey).digest("hex")
    : null;
  const event = await admin.from("trader_intelligence_events").upsert({
    user_id: input.userId,
    event_type: input.eventType,
    route: input.route?.slice(0, 160) ?? null,
    context: safeContext(input.context),
    dedupe_key: dedupeKey,
    occurred_at: now,
  }, {
    onConflict: "user_id,event_type,dedupe_key",
    ignoreDuplicates: Boolean(dedupeKey),
  });
  if (event.error) {
    console.warn("[TRADER_INTELLIGENCE_EVENT_WRITE_FAILED]", { eventType: input.eventType });
    return false;
  }
  await admin.from("trader_intelligence_profiles").upsert({
    user_id: input.userId,
    last_seen_at: now,
    last_material_event_at: now,
  }, { onConflict: "user_id" });
  return true;
}
