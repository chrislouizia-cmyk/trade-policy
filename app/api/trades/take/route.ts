import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    const body = await request.json();
    const entry = Number(body.entry), stopLoss = Number(body.stopLoss), takeProfit = Number(body.takeProfit);
    const riskPercent = Number(body.riskPercent ?? 0.5), initialRR = Number(body.initialRR);
    if (!body.instrument || !['BUY','SELL'].includes(body.direction) || typeof body.highImpactNews !== 'boolean' || ![entry,stopLoss,takeProfit,riskPercent,initialRR].every(Number.isFinite)) {
      return NextResponse.json({ error: 'Missing or invalid trade information.' }, { status: 400 });
    }
    const { data: existing, error: existingError } = await supabase.from('active_trades').select('id').eq('user_id', user.id).eq('instrument', body.instrument).eq('status','OPEN').maybeSingle();
    if (existingError) throw existingError;
    if (existing) return NextResponse.json({ error: 'You already have an open trade for this instrument.' }, { status: 409 });
    const { data: trade, error } = await supabase.from('active_trades').insert({
      user_id:user.id, account_id:body.accountId ?? null, balance_at_entry:body.balanceAtEntry ?? null, risk_amount:body.riskAmount ?? null, strategy_profile_id:body.strategyProfileId ?? null, strategy_name_at_entry:body.strategyNameAtEntry ?? null, strategy_snapshot:{...(body.strategySnapshot ?? {}),tradeContext:{highImpactNews:body.highImpactNews}}, trade_record_id:body.tradeRecordId ?? null,
      instrument:body.instrument, direction:body.direction, entry, stop_loss:stopLoss, take_profit:takeProfit,
      risk_percent:riskPercent, initial_rr:initialRR, setup_type:body.setupType ?? null, initial_score:body.initialScore ?? null,
      initial_analysis:body.initialAnalysis ?? null, status:'OPEN', current_price:entry, current_r:0, mfe_r:0, mae_r:0,
      taken_against_verdict:Boolean(body.takenAgainstVerdict), original_verdict:body.originalVerdict ?? null,
      original_verdict_reason:body.originalVerdictReason ?? null, override_reason:body.overrideReason ?? null,
    }).select().single();
    if (error) throw error;
    await supabase.from('active_trade_events').insert({ user_id:user.id, trade_id:trade.id,
      event_type: body.takenAgainstVerdict ? 'TRADE_TAKEN_AGAINST_VERDICT' : 'TRADE_TAKEN',
      verdict: body.takenAgainstVerdict ? `OPEN — AGAINST ${body.originalVerdict ?? 'VERDICT'}` : 'OPEN',
      current_price:entry, current_r:0, analysis:{ original_analysis:body.initialAnalysis ?? null, original_verdict:body.originalVerdict ?? null, original_verdict_reason:body.originalVerdictReason ?? null, override_reason:body.overrideReason ?? null }
    });
    return NextResponse.json({ trade });
  } catch (error) {
    return publicApiError({message:'We could not record this trade. Please try again.',code:'TRADE_SAVE_FAILED',internalCode:'TRADE_SAVE_FAILED',endpoint:'/app/api/trades/take',error});
  }
}
