import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameRequestOrigin } from "@/lib/request-origin";
import { refreshTraderLearning } from "@/lib/server/trader-context";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
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

  const refreshedAt = profile.data?.last_refresh_at
    ? new Date(profile.data.last_refresh_at).getTime()
    : 0;
  if (!refreshedAt || now.getTime() - refreshedAt > 6 * 60 * 60_000) {
    const result = await refreshTraderLearning(admin, user.id);
    if (result.updated)
      await admin
        .from("trader_intelligence_profiles")
        .update({ last_refresh_at: now.toISOString() })
        .eq("user_id", user.id);
  }
  return new NextResponse(null, { status: 204 });
}
