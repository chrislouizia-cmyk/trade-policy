import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { loadActiveStrategy } from '@/lib/server/active-strategy';
import { loadDailyTradeContext } from '@/lib/server/daily-trade-context';
import { validateTradeWithStrategy } from '@/lib/server/decision-engine';
import { buildDecisionNarrative } from '@/lib/intelligence/decision-narrative';
import { enhanceDecisionNarrative } from '@/lib/server/decision-narrative-ai';
import { apiError } from '@/lib/server/public-error';
import type { TradeInput } from '@/types/trade';
import { confirmationState } from '@/lib/manual-confirmations';

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
  setupConfidence: z.number().min(0).max(100).optional(),
  manualConfirmations:z.array(z.object({evidenceKey:z.string().trim().min(1).max(120),state:z.enum(['PENDING','CONFIRMED','FAILED']).optional(),confirmed:z.boolean().optional(),note:z.string().max(240).optional()}).refine(value=>value.state!==undefined||value.confirmed!==undefined,{message:'Manual confirmation state required.'})).optional().default([]),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return apiError('UNAUTHORIZED','Unauthorized.',401);
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError('INVALID_TRADE','Some trade values are invalid.',400,parsed.error.flatten());
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
    const manualRuleKeys=new Set((strategy.rules??[]).filter(rule=>rule.enabled&&rule.evaluationMode==='MANUAL').map(rule=>rule.ruleKey));
    const invalidManual=parsed.data.manualConfirmations.find(item=>!manualRuleKeys.has(item.evidenceKey));
    if(invalidManual)return apiError('INVALID_MANUAL_CONFIRMATION',invalidManual.evidenceKey+' is not configured as a manual rule.',400);
    const normalizedConfirmations=parsed.data.manualConfirmations.map(item=>({...item,state:confirmationState(item)}));
    const input={...parsed.data,manualConfirmations:normalizedConfirmations} as TradeInput;
    const evidenceKeys=new Set(['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed']);
    for(const item of normalizedConfirmations)if(evidenceKeys.has(item.evidenceKey))(input as unknown as Record<string,unknown>)[item.evidenceKey]=item.state==='CONFIRMED';
    const result = validateTradeWithStrategy(input, strategy, dailyContext);
    const deterministicNarrative = buildDecisionNarrative({
      result,
      strategy,
      input: input as TradeInput,
    });
    let decisionNarrative = deterministicNarrative;
    try {
      decisionNarrative = await enhanceDecisionNarrative(deterministicNarrative);
    } catch (narrativeError) {
      console.error('Decision narrative error:', narrativeError);
    }

    return NextResponse.json(
      {
        ...result,
        strategy: {
          id: strategy.id,
          name: strategy.name,
          engineVersion:strategy.engineVersion??1,
        },
        manualConfirmations:normalizedConfirmations,
        decisionNarrative,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Validation error:', error);
    return apiError('VALIDATION_FAILED',error instanceof Error?error.message:'Trade authorization could not be completed.',500);
  }
}
