import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSameRequestOrigin } from "@/lib/request-origin";
import { recordTraderIntelligenceEvent } from "@/lib/server/trader-intelligence-events";

const schema = z.object({
  interventionId: z.string().uuid(),
  response: z.enum(["ACKNOWLEDGED", "DISMISSED", "HELPFUL", "NOT_HELPFUL"]),
  note: z.string().trim().max(280).optional(),
}).strict();

export async function POST(request: Request) {
  if (!isSameRequestOrigin(request))
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });

  const now = new Date().toISOString();
  const status = parsed.data.response === "DISMISSED" || parsed.data.response === "NOT_HELPFUL"
    ? "DISMISSED"
    : "ACKNOWLEDGED";
  const updated = await createAdminClient()
    .from("trader_intelligence_interventions")
    .update({
      response: parsed.data.response,
      response_note: parsed.data.note || null,
      responded_at: now,
      status,
      ...(status === "DISMISSED" ? { resolved_at: now } : {}),
    })
    .eq("id", parsed.data.interventionId)
    .eq("user_id", user.id)
    .select("id,intervention_key")
    .maybeSingle();
  if (updated.error)
    return NextResponse.json({ error: "Feedback could not be saved." }, { status: 503 });
  if (!updated.data)
    return NextResponse.json({ error: "Intervention not found." }, { status: 404 });

  await recordTraderIntelligenceEvent({
    userId: user.id,
    eventType: "INTERVENTION_RESPONDED",
    route: "/api/trader-intelligence/interventions/feedback",
    dedupeKey: `${updated.data.id}:${parsed.data.response}`,
    context: { interventionKey: updated.data.intervention_key, response: parsed.data.response, status },
  });
  return NextResponse.json({ saved: true, status }, { headers: { "Cache-Control": "no-store" } });
}
