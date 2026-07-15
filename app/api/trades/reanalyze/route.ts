import { NextResponse } from 'next/server';
import { publicApiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { fetchPrice, fetchSeries } from '@/lib/market-data';
import { buildLiveAnalysis } from '@/lib/market-analysis';
import { DEFAULT_STRATEGY_PROFILE, type StrategyProfile } from '@/types/trade';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error:'Unauthorized' }, { status:401 });
    const { tradeId } = await request.json();
    const { data:trade, error } = await supabase.from('active_trades').select('*').eq('id',tradeId).eq('user_id',user.id).single();
    if (error || !trade) return NextResponse.json({ error:'Active trade not found.' }, { status:404 });
    let strategy: StrategyProfile = DEFAULT_STRATEGY_PROFILE;
    if (trade.strategy_profile_id) {
      const { data } = await supabase.from('strategy_profiles').select('*').eq('id',trade.strategy_profile_id).eq('user_id',user.id).maybeSingle();
      if (data) strategy = { ...DEFAULT_STRATEGY_PROFILE, id:data.id, name:data.name, instruments:data.instruments || DEFAULT_STRATEGY_PROFILE.instruments, trendTimeframe:data.trend_timeframe, confirmationTimeframe:data.confirmation_timeframe, entryTimeframe:data.entry_timeframe, minimumRR:Number(data.minimum_rr), maximumRiskPercent:Number(data.maximum_risk_percent), maximumTradesPerDay:data.maximum_trades_per_day, allowedSessions:data.allowed_sessions, avoidHighImpactNews:data.avoid_high_impact_news, requireTrendAlignment:data.require_trend_alignment, requiredEvidence:data.required_evidence, evidenceWeights:data.evidence_weights, stopLimits:data.stop_limits, authorizationScore:data.authorization_score, waitScore:data.wait_score, lossStreakLimit:data.loss_streak_limit };
    }
    const tfs=[strategy.trendTimeframe,strategy.confirmationTimeframe,strategy.entryTimeframe];
    const values=await Promise.all(tfs.map(tf=>fetchSeries(trade.instrument,tf)));
    const analysis=buildLiveAnalysis(trade.instrument,strategy,Object.fromEntries(tfs.map((tf,i)=>[tf,values[i]])),'Twelve Data');
    const price=await fetchPrice(trade.instrument);
    const entry=Number(trade.entry), stop=Number(trade.stop_loss), target=Number(trade.take_profit);
    const riskDistance=Math.abs(entry-stop); const currentR=riskDistance?((trade.direction==='BUY'?price-entry:entry-price)/riskDistance):0;
    const invalidated=trade.direction==='BUY'?price<=stop:price>=stop;
    const targetHit=trade.direction==='BUY'?price>=target:price<=target;
    const aligned=analysis.suggestedDirection===trade.direction;
    let verdict='HOLD'; let reason='The original directional thesis remains valid.';
    if(invalidated){verdict='EXIT';reason='Price reached or crossed the original invalidation level.';}
    else if(targetHit){verdict='EXIT — TARGET HIT';reason='The original take-profit level has been reached.';}
    else if(!aligned && currentR < 0){verdict='REDUCE RISK';reason='Current multi-timeframe bias conflicts with the original thesis while the trade is negative.';}
    else if(!aligned){verdict='HOLD — PROTECT';reason='The market bias has shifted. Protect gains and avoid adding risk.';}
    else if(currentR>=1.5){verdict='TRAIL STOP';reason='The trade is beyond 1.5R and the thesis remains aligned. Protect accumulated profit.';}
    else if(currentR>=1){verdict='HOLD — PROTECT';reason='The trade reached at least 1R. Consider breakeven or the configured protection rule.';}
    else if(currentR<=-0.7){verdict='DO NOT INTERFERE';reason='The trade is near the stop but the original thesis is still aligned. Do not widen the stop.';}
    const mfeR=Math.max(Number(trade.mfe_r||0),currentR), maeR=Math.min(Number(trade.mae_r||0),currentR);
    const result={verdict,reason,currentPrice:price,currentR,mfeR,maeR,marketAnalysis:analysis,generatedAt:new Date().toISOString()};
    const { data:updated, error:updateError }=await supabase.from('active_trades').update({current_price:price,current_r:currentR,mfe_r:mfeR,mae_r:maeR,last_verdict:verdict,last_verdict_reason:reason,last_analysis:result,last_analyzed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',trade.id).eq('user_id',user.id).select().single();
    if(updateError) throw updateError;
    await supabase.from('active_trade_events').insert({user_id:user.id,trade_id:trade.id,event_type:'REANALYSIS',verdict,current_price:price,current_r:currentR,analysis:result});
    return NextResponse.json({trade:updated,analysis:result});
  } catch(error){return publicApiError({message:'Active trade guidance is temporarily unavailable. Your trade was not changed.',code:'ACTIVE_TRADE_REANALYSIS_FAILED',internalCode:'ACTIVE_TRADE_REANALYSIS_FAILED',endpoint:'/app/api/trades/reanalyze',error});}
}
