import {NextResponse} from 'next/server';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {fetchPrice,fetchSeries} from '@/lib/market-data';
import {buildLiveAnalysis} from '@/lib/market-analysis';
import {normalizeStrategyPolicy,StrategyConfigurationError} from '@/lib/strategy-policy';
import {validateTradeWithStrategy} from '@/lib/server/decision-engine';
import {loadDailyTradeContext} from '@/lib/server/daily-trade-context';
import type {EvidenceKey,StrategyProfile,TradeInput} from '@/types/trade';

export const runtime='nodejs';export const maxDuration=60;
const requestSchema=z.object({tradeId:z.string().uuid()});
type GuidanceStatus='HOLD'|'PROTECT'|'EXIT'|'INVALIDATED';

function failure(error:string,code:string,status:number,details?:Record<string,unknown>){return NextResponse.json({error,code,details},{status});}
function finite(value:unknown){const number=Number(value);return Number.isFinite(number)?number:null;}

export async function POST(request:Request){
  try{
    const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
    if(!user)return failure('Authentication is required.','UNAUTHORIZED',401);
    const parsed=requestSchema.safeParse(await request.json());
    if(!parsed.success)return failure('A valid active trade ID is required.','INVALID_TRADE_ID',400);
    const {data:trade,error:tradeError}=await supabase.from('active_trades').select('*').eq('id',parsed.data.tradeId).eq('user_id',user.id).eq('status','OPEN').maybeSingle();
    if(tradeError)throw tradeError;if(!trade)return failure('Active trade not found.','ACTIVE_TRADE_NOT_FOUND',404,{tradeId:parsed.data.tradeId});
    const entry=finite(trade.entry),stopLoss=finite(trade.stop_loss),takeProfit=finite(trade.take_profit),riskPercent=finite(trade.risk_percent);
    const missing=[!trade.instrument&&'instrument',!['BUY','SELL'].includes(trade.direction)&&'direction',entry===null&&'entry',stopLoss===null&&'stop loss',takeProfit===null&&'take profit',riskPercent===null&&'risk percent',!trade.strategy_profile_id&&'strategy ID',!trade.setup_type&&'setup type'].filter(Boolean);
    if(missing.length)return failure(`Active trade is missing required values: ${missing.join(', ')}.`,'MALFORMED_ACTIVE_TRADE',422,{missing});
    const snapshot=trade.strategy_snapshot;
    const hasStoredStrategy=snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)&&snapshot.id===trade.strategy_profile_id;
    if(!hasStoredStrategy)return failure('The strategy snapshot stored with this trade is missing or corrupted.','TRADE_STRATEGY_SNAPSHOT_INVALID',422);
    const strategy:StrategyProfile=snapshot as StrategyProfile;
    const policy=normalizeStrategyPolicy(strategy);
    if(!policy.instruments.includes(trade.instrument))return failure(`${trade.instrument} is not enabled in the active strategy.`,'UNSUPPORTED_INSTRUMENT',400,{instrument:trade.instrument});
    const timeframes=[policy.timeframes.trend,policy.timeframes.confirmation,policy.timeframes.entry];
    let values;
    try{values=await Promise.all(timeframes.map(timeframe=>fetchSeries(trade.instrument,timeframe)));}catch(error){return failure(error instanceof Error?error.message:'Twelve Data could not return configured candles.','MARKET_DATA_UNAVAILABLE',503,{provider:'Twelve Data',instrument:trade.instrument,timeframes});}
    if(values.some(candles=>candles.length<25))return failure('Twelve Data returned insufficient candles for deterministic analysis.','INSUFFICIENT_MARKET_DATA',422,{instrument:trade.instrument,timeframes});
    let currentPrice:number;try{currentPrice=await fetchPrice(trade.instrument);}catch(error){return failure(error instanceof Error?error.message:'Current price is unavailable.','CURRENT_PRICE_UNAVAILABLE',503,{provider:'Twelve Data',instrument:trade.instrument});}
    const analysis=buildLiveAnalysis(trade.instrument,strategy,Object.fromEntries(timeframes.map((timeframe,index)=>[timeframe,values[index]])),'Twelve Data');
    const {data:record}=trade.trade_record_id?await supabase.from('trade_records').select('session,rule_snapshot').eq('id',trade.trade_record_id).eq('user_id',user.id).maybeSingle():{data:null};
    const session=record?.session;const newsValue=snapshot.tradeContext?.highImpactNews??record?.rule_snapshot?.highImpactNews;
    const newsUnknown=typeof newsValue!=='boolean';
    if(!session)return failure('The original trade session is missing.','MISSING_TRADE_SESSION',422);
    const evidence=Object.fromEntries((Object.entries(analysis.evidence) as [EvidenceKey,{value:boolean}][]).map(([key,value])=>[key,value.value]));
    const validationInput={instrument:trade.instrument,direction:trade.direction,entry:entry!,stopLoss:stopLoss!,takeProfit:takeProfit!,accountBalance:finite(trade.balance_at_entry)??1,riskPercent:riskPercent!,tradesToday:0,session,highImpactNews:Boolean(newsValue),...evidence,setupType:analysis.setupType,setupConfidence:analysis.setupConfidence} as TradeInput;
    const dailyContext=await loadDailyTradeContext({supabase,userId:user.id,strategy,instrument:trade.instrument,accountId:trade.account_id,timezone:'UTC'});
    const validation=validateTradeWithStrategy(validationInput,strategy,dailyContext);
    const riskDistance=Math.abs(entry!-stopLoss!);const currentR=riskDistance?((trade.direction==='BUY'?currentPrice-entry!:entry!-currentPrice)/riskDistance):0;
    const invalidated=trade.direction==='BUY'?currentPrice<=stopLoss!:currentPrice>=stopLoss!;const targetHit=trade.direction==='BUY'?currentPrice>=takeProfit!:currentPrice<=takeProfit!;const aligned=analysis.suggestedDirection===trade.direction;
    let status:GuidanceStatus='HOLD',nextAction='Keep the original plan and do not widen risk.';
    if(invalidated){status='INVALIDATED';nextAction='The original invalidation level has been reached. Review the trade for exit.';}
    else if(targetHit){status='EXIT';nextAction='The original take-profit level has been reached. Review the trade for closure.';}
    else if(validation.verdict==='REJECTED'&&!aligned){status='EXIT';nextAction='The current strategy no longer supports the original thesis. Review the trade for exit.';}
    else if(!aligned||validation.verdict!=='AUTHORIZED'||currentR>=1){status='PROTECT';nextAction='Do not add risk. Review whether the existing stop should protect the position.';}
    const reasons=[...validation.vetoes,...validation.observations,...analysis.warnings];
    if(newsUnknown)reasons.unshift('Original news-state snapshot unavailable. News protection could not be verified for this legacy trade.');
    if(!reasons.length)reasons.push('The current market structure remains compatible with the stored trade strategy.');
    const guidance={status,confidence:analysis.setupConfidence,currentPrice,reasons:[...new Set(reasons)],nextAction,generatedAt:new Date().toISOString(),strategy:{id:strategy.id,name:strategy.name},setupType:analysis.setupType,waitingFor:analysis.waitingFor,validationVerdict:validation.verdict};
    const {error:eventError}=await supabase.from('active_trade_events').insert({user_id:user.id,trade_id:trade.id,event_type:'REANALYSIS',verdict:status,current_price:currentPrice,current_r:currentR,analysis:guidance});if(eventError)throw eventError;
    const {error:updateError}=await supabase.from('active_trades').update({current_price:currentPrice,current_r:currentR,mfe_r:Math.max(Number(trade.mfe_r??0),currentR),mae_r:Math.min(Number(trade.mae_r??0),currentR),last_verdict:status,last_verdict_reason:nextAction,last_analysis:guidance,last_analyzed_at:guidance.generatedAt,updated_at:guidance.generatedAt}).eq('id',trade.id).eq('user_id',user.id);if(updateError)throw updateError;
    return NextResponse.json({guidance},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    if(error instanceof StrategyConfigurationError)return failure(error.message,'STRATEGY_CONFIGURATION_ERROR',409,{missingFields:error.missingFields});
    return failure('Active trade guidance could not be completed. Your trade was not changed.','ACTIVE_TRADE_REANALYSIS_FAILED',500,{cause:error instanceof Error?error.message:'Unknown server error'});
  }
}
