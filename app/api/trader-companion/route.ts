import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTraderContext } from "@/lib/server/trader-context";
import { generateTraderCompanion } from "@/lib/server/trader-companion";
import { isSameRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 60;
const contextSchema = z
  .object({
    strategyId: z.string().uuid().optional(),
    analysisId: z.string().uuid().optional(),
    tradeId: z.string().uuid().optional(),
    backtestId: z.string().uuid().optional(),
    decisionSourceId: z.string().uuid().optional(),
  })
  .strict();
const schema = z
  .object({
    sessionId: z.string().uuid(),
    version: z.number().int().nonnegative(),
    message: z.string().trim().min(1).max(3000),
    locale: z.enum(["en", "es", "fr"]).default("en"),
    context: contextSchema.default({}),
    remember: z.enum(["PREFERENCE", "CORRECTION", "NOTE"]).optional(),
  })
  .strict();
const headers = { "Cache-Control": "no-store" };
const failure = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers });

export async function GET(request: Request) {
  try {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return failure("Authentication required.", 401);
    const url = new URL(request.url);
    const raw = Object.fromEntries(
      [
        "strategyId",
        "analysisId",
        "tradeId",
        "backtestId",
        "decisionSourceId",
      ].flatMap((key) =>
        url.searchParams.get(key) ? [[key, url.searchParams.get(key)!]] : [],
      ),
    );
    const parsed = contextSchema.safeParse(raw);
    if (!parsed.success) return failure("Invalid context.", 400);
    const context = await loadTraderContext(client, user.id, parsed.data);
    const sessionId = url.searchParams.get("sessionId");
    let session = null;
    if (sessionId) {
      if (!z.string().uuid().safeParse(sessionId).success)
        return failure("Invalid session.", 400);
      const result = await client
        .from("trader_companion_sessions")
        .select("id,messages,version")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      session = result.data;
    }
    return NextResponse.json(
      { userId: user.id, ...context, session },
      { headers },
    );
  } catch (error) {
    return failure(
      error instanceof Error && error.message === "CONTEXT_NOT_FOUND"
        ? "This context is unavailable."
        : "Trader context could not be loaded.",
      503,
    );
  }
}

export async function POST(request: Request) {
  if (!isSameRequestOrigin(request))
    return failure("Invalid request origin.", 403);
  try {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return failure("Authentication required.", 401);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return failure("Invalid conversation request.", 400);
    if (parsed.data.remember && parsed.data.message.length > 1000)
      return failure("Memories must be at most 1000 characters.", 400);
    const body = parsed.data;
    const admin = createAdminClient();
    const initial = await client
      .from("trader_companion_sessions")
      .select("id,messages,version")
      .eq("id", body.sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (initial.error) throw initial.error;
    let session = initial.data;
    if (!session) {
      if (body.version !== 0)
        return failure("Reload this conversation before continuing.", 409);
      const inserted = await admin
        .from("trader_companion_sessions")
        .insert({ id: body.sessionId, user_id: user.id })
        .select("id,messages,version")
        .single();
      if (inserted.error)
        return failure("Start or reload your conversation.", 409);
      session = inserted.data;
    }
    if (!session || session.version !== body.version)
      return failure(
        "Another reply changed this conversation. Reload it before continuing.",
        409,
      );
    // Generate first, then persist with optimistic concurrency. Stale responses never replace history.
    const context = await loadTraderContext(client, user.id, body.context);
    const output = await generateTraderCompanion({
      facts: context.facts,
      profile: context.profile,
      message: body.message,
      history: session.messages,
      locale: body.locale,
      memorySaved: false,
    });
    const evidence = context.facts.filter((fact) =>
      output.reply.evidenceIds.includes(fact.id),
    );
    const messages = [
      ...(Array.isArray(session.messages) ? session.messages : []),
      { role: "user", text: body.message },
      {
        role: "assistant",
        createdAt: new Date().toISOString(),
        evidence,
        text: output.reply.message,
        question: output.reply.question,
        source: output.source,
        evidenceIds: output.reply.evidenceIds,
      },
    ].slice(-40);
    const saved = await admin.rpc("save_trader_companion_turn", {
      p_user_id: user.id,
      p_session_id: session.id,
      p_version: body.version,
      p_messages: messages,
      p_source: output.source,
      p_model: output.model,
      p_failure_code: output.failureCode,
      p_evidence_ids: output.reply.evidenceIds,
      p_response: { ...output.reply, evidence },
      p_memory_category: body.remember ?? null,
      p_memory_content: body.remember ? body.message : null,
    });
    if (saved.error) throw saved.error;
    if (!saved.data)
      return failure(
        "Another reply changed this conversation. Reload it before continuing.",
        409,
      );
    const memorySaved = Boolean(body.remember);
    return NextResponse.json(
      {
        ...output,
        sessionId: session.id,
        version: body.version + 1,
        memorySaved,
        messages,
        facts: context.facts,
      },
      { headers },
    );
  } catch {
    return failure(
      "The conversation could not be completed. Your trading rules were not changed.",
      503,
    );
  }
}

export async function DELETE(request: Request) {
  if (!isSameRequestOrigin(request))
    return failure("Invalid request origin.", 403);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return failure("Authentication required.", 401);
  const body = await request.json().catch(() => null);
  const id = z.string().uuid().safeParse(body?.memoryId);
  if (!id.success) return failure("A valid memory is required.", 400);
  const { error } = await createAdminClient()
    .from("trader_memories")
    .delete()
    .eq("id", id.data)
    .eq("user_id", user.id);
  if (error) return failure("Memory could not be removed.", 503);
  return NextResponse.json({ deleted: true }, { headers });
}
