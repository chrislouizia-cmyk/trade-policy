import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameRequestOrigin } from "@/lib/request-origin";
import { processTraderIntelligenceQueue } from "@/lib/server/trader-intelligence-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  locale: z.enum(["en","es","fr"]).optional(),
  timezone: z.string().trim().min(1).max(80),
  route: z.string().trim().startsWith("/").max(160),
}).strict();

function isTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameRequestOrigin(request))
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isTimezone(parsed.data.timezone))
    return NextResponse.json({ error: "Invalid intelligence context." }, { status: 400 });

  const admin = createAdminClient();
  const now = new Date();
  const profile = await admin
    .from("trader_intelligence_profiles")
    .upsert({
      user_id: user.id,
      timezone: parsed.data.timezone,
      ...(parsed.data.locale?{locale:parsed.data.locale}:{}),
      last_seen_at: now.toISOString(),
    }, { onConflict: "user_id" })
    .select("last_refresh_at")
    .single();
  if (profile.error)
    return NextResponse.json({ error: "Intelligence profile unavailable." }, { status: 503 });

  const recent = await admin
    .from("trader_intelligence_events")
    .select("id")
    .eq("user_id", user.id)
    .eq("event_type", "PAGE_VIEW")
    .eq("route", parsed.data.route)
    .gte("occurred_at", new Date(now.getTime() - 30 * 60_000).toISOString())
    .limit(1);
  if (recent.error)
    return NextResponse.json({ error: "Intelligence event unavailable." }, { status: 503 });
  if (!recent.data?.length)
    await admin.from("trader_intelligence_events").insert({
      user_id: user.id,
      event_type: "PAGE_VIEW",
      route: parsed.data.route,
      context: {},
    });

  after(async () => {
    try { await processTraderIntelligenceQueue({userId:user.id}); }
    catch { console.warn("[INTELLIGENCE_BACKGROUND_FAILED]"); }
  });
  return new NextResponse(null, { status: 204 });
}
