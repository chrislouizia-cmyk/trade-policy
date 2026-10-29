import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processTraderIntelligenceQueue } from "@/lib/server/trader-intelligence-worker";
import { rebuildCollectivePatterns } from "@/lib/server/trader-intelligence-state";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !supplied) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  const seeded = await admin.rpc("enqueue_daily_trader_intelligence", {p_limit:200});
  if (seeded.error) return NextResponse.json({error:"Refresh queue unavailable."},{status:503});
  const {refreshed,failed} = await processTraderIntelligenceQueue({budgetMs:40_000});
  await admin
    .from("trader_intelligence_events")
    .delete()
    .lt("occurred_at", new Date(Date.now() - 400 * 86_400_000).toISOString());
  let collectivePatterns = 0;
  try {
    collectivePatterns = await rebuildCollectivePatterns(admin);
  } catch {
    console.warn("[TRADER_COLLECTIVE_REFRESH_FAILED]");
  }
  return NextResponse.json({
    processed: refreshed + failed,
    refreshed,
    failed,
    collectivePatterns,
  });
}
