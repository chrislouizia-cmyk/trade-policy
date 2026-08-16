import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildStrategyCopilotInstructions, ensureStrategyCopilotSession, mergeStrategyCopilotDraft, normalizeStrategyCopilotReply, strategyCopilotSchema } from '@/lib/strategy-copilot';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const auth = await createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const body = await request.json().catch(() => null) as {
      sessionId?: string;
      message?: string;
      previousDraft?: Record<string, unknown>;
    } | null;

    if (!body?.message) {
      return NextResponse.json({ error: 'A message is required.' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      const fallbackDraft = body.previousDraft ? {
        sessions: Array.isArray(body.previousDraft.sessions) ? body.previousDraft.sessions.filter((item): item is string => typeof item === 'string') : [],
        timeframes: Array.isArray(body.previousDraft.timeframes) ? body.previousDraft.timeframes.filter((item): item is string => typeof item === 'string') : [],
        rules: [],
        logicTree: { logic: 'ALL', children: [] },
        notes: [body.message],
      } : {
        sessions: [],
        timeframes: [],
        rules: [],
        logicTree: { logic: 'ALL', children: [] },
        notes: [body.message],
      };

      return NextResponse.json({
        message: 'AI drafting is not configured. Your draft remains in review mode and can still be edited manually.',
        intent: 'CLARIFY',
        strategyDraft: fallbackDraft,
        changes: ['AI drafting unavailable'],
        unresolvedQuestions: ['OpenAI API key is not configured.'],
      });
    }

    const sessionId = body.sessionId || `strategy-copilot-${user.id}-${Date.now()}`;
    const currentSession = ensureStrategyCopilotSession(sessionId);
    const previousDraft = body.previousDraft ? mergeStrategyCopilotDraft(currentSession.draft, body.previousDraft as any) : currentSession.draft;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input: [{
          role: 'system',
          content: [{
            type: 'input_text',
            text: buildStrategyCopilotInstructions(),
          }],
        }, {
          role: 'user',
          content: [{
            type: 'input_text',
            text: JSON.stringify({
              currentDraft: previousDraft,
              userMessage: body.message,
              constraints: [
                'Never invent new rule IDs or capabilities.',
                'Resolve using only existing rule keys from the current catalog.',
                'DESCRIPTIVE rules remain OPTIONAL and non-authoritative.',
                'The deterministic engine is the source of authority; the AI only drafts and updates.',
                'Keep the same draft when the user is clarifying or modifying existing requirements.',
              ],
            }),
          }],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'trade_police_strategy_copilot',
            strict: true,
            schema: strategyCopilotSchema,
          },
        },
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json({
        message: 'The strategy copilot is temporarily unavailable. Your last draft is still available for review.',
        intent: 'CLARIFY',
        strategyDraft: previousDraft,
        changes: ['AI provider request failed'],
        unresolvedQuestions: ['The AI provider did not respond successfully.'],
      }, { status: 502 });
    }

    const raw = await response.json();
    const text = raw.output_text ?? raw.output
      ?.flatMap((item: any) => item.content ?? [])
      .find((item: any) => item.type === 'output_text')?.text;

    if (!text) {
      return NextResponse.json({
        message: 'The AI did not return a valid draft. Please review or refine the strategy manually.',
        intent: 'NONE',
        strategyDraft: previousDraft,
        changes: ['Invalid model output'],
        unresolvedQuestions: ['The response was empty or malformed.'],
      }, { status: 422 });
    }

    const parsed = JSON.parse(text);
    const normalized = normalizeStrategyCopilotReply(parsed, previousDraft);
    const nextDraft = mergeStrategyCopilotDraft(previousDraft, normalized.strategyDraft);
    const nextState = { ...currentSession, draft: nextDraft, updatedAt: Date.now() };
    nextState.messages = [...nextState.messages, { role: 'user', text: body.message, createdAt: new Date().toISOString() }, { role: 'assistant', text: normalized.message, createdAt: new Date().toISOString() }];

    return NextResponse.json({
      sessionId,
      ...normalized,
      strategyDraft: nextDraft,
    });
  } catch (error) {
    console.error('Strategy copilot route failed', error);
    return NextResponse.json({
      message: 'The strategy copilot failed unexpectedly. Please review the current draft and continue manually.',
      intent: 'CLARIFY',
      strategyDraft: { sessions: [], timeframes: [], rules: [], logicTree: { logic: 'ALL', children: [] }, notes: [] },
      changes: ['Unexpected server error'],
      unresolvedQuestions: ['The server encountered an unexpected error.'],
    }, { status: 500 });
  }
}
