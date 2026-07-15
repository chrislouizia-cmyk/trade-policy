import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { loadActiveStrategy } from '@/lib/server/active-strategy';
import { loadDailyTradeContext } from '@/lib/server/daily-trade-context';
import { validateTradeWithStrategy } from '@/lib/server/decision-engine';

export const dynamic = 'force-dynamic';

const schema = z.object({
  instrument: z.string().trim().min(1).max(30),
  direction: z.enum(['BUY', 'SELL']),
  entry: z.number().finite(),
  stopLoss: z.number().finite(),
  takeProfit: z.number().finite(),
  accountBalance: z.number().positive().finite(),
  accountId: z.string().uuid().nullable().optional(),
  userTimezone: z.string().trim().min(1).max(100).optional(),
  riskPercent: z.number().positive().finite(),
  tradesToday: z.number().int().min(0),
  session: z.string().trim().min(1).max(80),
  highImpactNews: z.boolean(),
  h4TrendAligned: z.boolean(),
  h1TrendAligned: z.boolean(),
  structurePattern: z.boolean(),
  liquiditySweep: z.boolean(),
  chochConfirmed: z.boolean(),
  bosConfirmed: z.boolean(),
  orderBlock: z.boolean(),
  fairValueGap: z.boolean(),
  retestConfirmed: z.boolean(),
  setupType: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Some trade values are invalid.',
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const strategy = await loadActiveStrategy(supabase, user.id);
    const dailyContext = await loadDailyTradeContext({
      supabase,
      userId: user.id,
      strategy,
      instrument: parsed.data.instrument,
      accountId: parsed.data.accountId,
      timezone: parsed.data.userTimezone || 'UTC',
    });
    const result = validateTradeWithStrategy(parsed.data, strategy, dailyContext);

    return NextResponse.json(
      {
        ...result,
        strategy: {
          id: strategy.id,
          name: strategy.name,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Trade authorization could not be completed.',
      },
      { status: 500 },
    );
  }
}
