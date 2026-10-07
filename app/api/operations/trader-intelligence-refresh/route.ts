import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshTraderLearning } from "@/lib/server/trader-context";
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
  const candidates = await admin
    .from("trader_intelligence_profiles")
    .select("user_id")
    .order("last_refresh_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (candidates.error)
    return NextResponse.json({ error: "Refresh queue unavailable." }, { status: 503 });

  let refreshed = 0;
  let failed = 0;
  for (let index = 0; index < (candidates.data?.length ?? 0); index += 5) {
    const batch = candidates.data!.slice(index, index + 5);
    const outcomes = await Promise.all(
      batch.map(async ({ user_id }) => {
        const result = await refreshTraderLearning(admin, user_id);
        if (result.updated)
          await admin
            .from("trader_intelligence_profiles")
            .update({ last_refresh_at: new Date().toISOString() })
            .eq("user_id", user_id);
        return result.updated;
      }),
    );
    refreshed += outcomes.filter(Boolean).length;
    failed += outcomes.filter((value) => !value).length;
  }
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
    processed: candidates.data?.length ?? 0,
    refreshed,
    failed,
    collectivePatterns,
  });
}
