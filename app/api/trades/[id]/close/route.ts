import { refreshTraderLearning } from '@/lib/server/trader-context';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicApiError } from '@/lib/server/public-error';
import { isTradeLifecycleV2Enabled } from '@/lib/server/trade-lifecycle-v2';
import { buildTraderInterventions } from '@/lib/trader-intelligence';
import { loadTraderLearningSnapshot, recordTraderInterventions } from '@/lib/server/trader-intelligence-state';
import { recordTraderIntelligenceEvent } from '@/lib/server/trader-intelligence-events';

const requestSchema = z.object({
  closePrice: z.coerce.number(),
  fees: z.coerce.number().optional().default(0),
  notes: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
}).passthrough();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (!isTradeLifecycleV2Enabled()) {
      return NextResponse.json(
        { error: 'Trade lifecycle V2 is disabled for this environment.', code: 'TRADE_LIFECYCLE_V2_DISABLED' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const { id } = await context.params;
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Invalid close payload.',
        code: 'INVALID_CLOSE_PAYLOAD',
        details: parsed.error.flatten(),
      }, { status: 400 });
    }

    const tradeContext=await supabase.from('active_trades').select('id,instrument,opened_at,strategy_profile_id,strategy_name_at_entry,taken_against_verdict,strategy_snapshot').eq('id',id).eq('user_id',user.id).maybeSingle();
    if(tradeContext.error||!tradeContext.data)return NextResponse.json({error:'Active trade not found.',code:'ACTIVE_TRADE_NOT_FOUND'},{status:404});

    const admin = createAdminClient();
    const response = await admin.rpc('close_trade_v2', {
      p_user_id: user.id,
      p_trade_id: id,
      p_close_price: Number(parsed.data.closePrice),
      p_fees: Number(parsed.data.fees ?? 0),
      p_notes: parsed.data.notes ?? null,
      p_outcome: parsed.data.outcome ?? null,
    });

    if (response.error) {
      return NextResponse.json({
        error: response.error.message || 'The trade could not be closed.',
        code: response.error.code || 'TRADE_CLOSE_FAILED',
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }

    const learning = await refreshTraderLearning(supabase,user.id);
    const snapshot=await loadTraderLearningSnapshot(user.id);
    const storedStrategy=tradeContext.data.strategy_snapshot as {tradeContext?:{session?:string}}|null;
    const personalInterventions=buildTraderInterventions(snapshot,{stage:'POST_TRADE',at:tradeContext.data.opened_at?new Date(tradeContext.data.opened_at):new Date(),instrument:tradeContext.data.instrument,session:storedStrategy?.tradeContext?.session,strategyId:tradeContext.data.strategy_profile_id,strategyName:tradeContext.data.strategy_name_at_entry,takenAgainstVerdict:tradeContext.data.taken_against_verdict===true});
    const storedInterventions=await recordTraderInterventions(user.id,personalInterventions,{stage:'POST_TRADE',tradeId:id});
    const resultValue=response.data as unknown;
    const resultObject=resultValue&&typeof resultValue==='object'?resultValue as Record<string,unknown>:{};
    await recordTraderIntelligenceEvent({userId:user.id,eventType:'TRADE_CLOSED',route:'/api/trades/[id]/close',dedupeKey:id,context:{tradeId:id,strategyId:tradeContext.data.strategy_profile_id,instrument:tradeContext.data.instrument,resultR:resultObject.result_r,outcome:resultObject.outcome,takenAgainstVerdict:tradeContext.data.taken_against_verdict===true}});
    return NextResponse.json({
      learning,
      result: response.data,
      route: 'close_trade_v2',
      personalIntelligence:{authoritative:false,controlsVerdict:false,interventions:storedInterventions},
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return publicApiError({
      message: 'We could not close this trade. No balance change was applied.',
      code: 'TRADE_CLOSE_FAILED',
      internalCode: 'TRADE_CLOSE_FAILED',
      endpoint: '/api/trades/[id]/close',
      error,
    });
  }
}
