import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildLiveAnalysis, MarketAnalysisError } from '@/lib/market-analysis';
import { fetchSeriesWithTelemetry, MarketDataProviderError, providerSymbol } from '@/lib/market-data';
import { type ChartAnalysis, type Instrument } from '@/types/trade';
import { loadStrategyById } from '@/lib/server/active-strategy';
import { apiError, publicApiError } from '@/lib/server/public-error';
import { getUserDisplayName } from '@/lib/user-display-name';
import { buildAICommentary } from '@/lib/ai-commentary';
import { explainDeterministicAnalysis } from '@/lib/server/openai-commentary';
import { StrategyConfigurationError } from '@/lib/strategy-policy';
import { strategyTimeframes } from '@/lib/strategy-timeframes';
import {finalizeAnalysis,reserveAnalysis} from '@/lib/billing/entitlements';
import {createAdminClient} from '@/lib/supabase/admin';
import {strategyRevisionId} from '@/lib/historical-decisions/strategy-revision';
import {withTwelveDataCredits,ProviderCreditLimitError} from '@/lib/server/provider-credit-coordinator';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function bestEffort(work:()=>PromiseLike<unknown>){try{await work()}catch(error){console.error('Non-critical analysis telemetry failed',error)}}

export async function POST(req: Request) {
  const startedAt=Date.now();
  let supabase: Awaited<ReturnType<typeof createClient>> | null=null;
  let usage:{userId:string;requestKey:string}|null=null;
  try {
    supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return apiError('UNAUTHORIZED','Unauthorized.',401);
    const requestKey=req.headers.get('idempotency-key');
    if(!requestKey||requestKey.length>100)return apiError('IDEMPOTENCY_KEY_REQUIRED','A valid analysis request key is required.',400);
    const reservation=await reserveAnalysis(user.id,requestKey);
    if(!reservation.allowed)return apiError('ANALYSIS_LIMIT_REACHED',`Your ${reservation.state.entitlements.monthlyAnalysisLimit ?? ''}-analysis cycle limit has been reached. Your analyses renew on ${reservation.state.usagePeriodEnd}. Upgrade to continue.`,429,{limit:reservation.state.entitlements.monthlyAnalysisLimit,used:reservation.state.usage,periodStart:reservation.state.usagePeriodStart,renewsAt:reservation.state.usagePeriodEnd});
    usage={userId:user.id,requestKey};
    const body=await req.json().catch(()=>null) as {instrument?:Instrument;strategyId?:string;strategyRevisionId?:string}|null;
    const instrument=body?.instrument;
    if (!instrument) return apiError('INSTRUMENT_REQUIRED','An instrument is required.',400);
    if(!body?.strategyId||!body.strategyRevisionId)return apiError('STRATEGY_CONTEXT_REQUIRED','The selected strategy and revision are required.',400);
    const strategy = await loadStrategyById(supabase,user.id,body.strategyId);
    const currentStrategyRevisionId=strategyRevisionId(strategy);
    if(body.strategyRevisionId!==currentStrategyRevisionId)return apiError('STRATEGY_REVISION_CHANGED','The selected strategy changed. Reload it before checking the market.',409);
    if (!strategy.instruments.includes(instrument)) return apiError('INSTRUMENT_DISABLED','Instrument is disabled in this strategy.',400,{instrument});
    const timeframes = strategyTimeframes(strategy);
    const values = await withTwelveDataCredits({requestKey:`analysis:${user.id}:${requestKey}`,operation:'live.analysis',priority:'LIVE',credits:timeframes.length},async()=>{
      const results=await Promise.all(timeframes.map((timeframe)=>fetchSeriesWithTelemetry(instrument,timeframe)));
      return{value:results.map(result=>result.value),telemetry:{
        creditsUsed:results.at(-1)?.telemetry.creditsUsed??null,creditsLeft:results.at(-1)?.telemetry.creditsLeft??null,
        requestCredits:results.reduce((sum,result)=>sum+(result.telemetry.requestCredits??1),0),observedAt:new Date().toISOString(),
      }};
    });
    const series = Object.fromEntries(timeframes.map((timeframe, index) => [timeframe, values[index]]));
    const analysis = buildLiveAnalysis(instrument, strategy, series, 'Twelve Data',providerSymbol(instrument));
    const displayName = await getUserDisplayName(supabase, user);
    const structuredAnalysis = analysis as unknown as ChartAnalysis;
    const deterministicCommentary = buildAICommentary(structuredAnalysis, strategy, displayName);
    const aiCommentary = await explainDeterministicAnalysis(structuredAnalysis, deterministicCommentary);
    const enrichedAnalysis = {...analysis, aiCommentary};
    const {data:scan,error:scanError}=await createAdminClient().from('market_scans').insert({ user_id: user.id, server_created:true, instrument, strategy_profile_id: strategy.id || null, strategy_revision_id:currentStrategyRevisionId, provider: 'twelvedata', timeframes, analysis: enrichedAnalysis }).select('id').single();
    if(scanError||!scan)throw scanError??new Error('Analysis record was not created.');
    await bestEffort(()=>supabase!.rpc('log_usage_event',{p_event_type:'MARKET_ANALYSIS',p_endpoint:'/api/market/analyze',p_instrument:instrument,p_success:true,p_duration_ms:Date.now()-startedAt,p_metadata:{provider:'twelvedata'}}));
    await bestEffort(()=>finalizeAnalysis(user.id,requestKey,true));
    const diagnostics=process.env.NODE_ENV==='development'?{strategyId:analysis.strategyId,strategyName:strategy.name,evaluationSource:'TRADING_DNA_RUNTIME',strategySchemaVersion:analysis.strategySchemaVersion,methodologyIds:analysis.methodologyIds,instrument,providerSymbol:analysis.providerSymbol,timeframes,candleCounts:Object.fromEntries(timeframes.map((frame,index)=>[frame,values[index].length])),latestCandleTimestamp:analysis.latestCandleTimestamp,totalRequiredWeight:analysis.setupReadiness.totalRequiredWeight,passingRequiredWeight:analysis.setupReadiness.passingRequiredWeight,requiredCounts:analysis.setupReadiness.required,optionalCounts:analysis.setupReadiness.optional,readinessFormula:analysis.setupReadiness.formula,contributingRules:analysis.tradingDnaReport.conditions.map(condition=>({id:condition.ruleId,status:condition.status,weight:condition.weight,evidenceSource:analysis.setupReadiness.conditions.find(item=>item.label===condition.label)?.evidenceSource})),timeframeAligned:analysis.timeframeAligned,finalState:analysis.setupReadiness.state,finalConfidence:analysis.liveAnalysisConfidence,calculationTimestamp:analysis.calculatedAt,cache:'MISS'}:undefined;
    return NextResponse.json({...enrichedAnalysis,analysisId:scan.id,strategyApplied:{id:strategy.id,name:strategy.name},marketSeries:series,diagnostics},{headers:{'Cache-Control':'no-store, max-age=0'}});
  } catch (error) {
    if(usage)try{await finalizeAnalysis(usage.userId,usage.requestKey,false)}catch(finalizeError){console.error('Analysis usage release failed',finalizeError)}
    if(error instanceof StrategyConfigurationError)return apiError('STRATEGY_INCOMPLETE','Strategy configuration incomplete.',409,{missingFields:error.missingFields});
    if(error instanceof MarketAnalysisError){
      const code=error.status==='INSUFFICIENT_DATA'?'INSUFFICIENT_MARKET_DATA':error.status==='ANALYSIS_FAILED'?'STRATEGY_CONFIGURATION_INCOMPLETE':'MARKET_DATA_UNAVAILABLE';
      const message=error.status==='INSUFFICIENT_DATA'?'Insufficient market data.':error.status==='ANALYSIS_FAILED'?'Strategy configuration incomplete.':'Market analysis unavailable.';
      return apiError(code,message,422,{analysisStatus:error.status});
    }
    if(error instanceof MarketDataProviderError&&error.code==='RATE_LIMITED'){
      console.warn('[TWELVE_DATA_RATE_LIMITED]',{endpoint:'/api/market/analyze',limitScope:error.limitScope,retryAfterSeconds:error.retryAfterSeconds});
      if(error.limitScope==='DAILY'){
        await bestEffort(()=>supabase!.rpc('log_system_incident',{p_public_code:'MARKET_DATA_RESTING',p_internal_code:'TWELVE_DATA_DAILY_LIMIT',p_provider:'twelvedata',p_endpoint:'/api/market/analyze',p_severity:'WARNING',p_message:'Daily provider capacity exhausted.',p_metadata:{dailyResetsAt:error.dailyResetsAt}}));
        return apiError('MARKET_DATA_DAILY_REST','Market data has reached today\'s safe capacity. Trade Police will be ready again after the daily refresh.',429,{retryAfterSeconds:error.retryAfterSeconds,dailyResetsAt:error.dailyResetsAt});
      }
      return apiError('MARKET_DATA_RATE_LIMITED','Market data needs another moment. Trade Police will retry automatically.',429,{retryAfterSeconds:error.retryAfterSeconds??61});
    }
    if(error instanceof ProviderCreditLimitError){
      if(error.reservation.retryAfterSeconds>65)return apiError('MARKET_DATA_DAILY_REST','Market data has reached today\'s safe capacity. Trade Police will be ready again after the daily refresh.',429,{retryAfterSeconds:error.reservation.retryAfterSeconds,dailyResetsAt:error.reservation.dailyResetsAt});
      return apiError('MARKET_DATA_CREDIT_WINDOW','Market data needs another moment. Trade Police will retry automatically.',429,{retryAfterSeconds:error.reservation.retryAfterSeconds,dailyResetsAt:error.reservation.dailyResetsAt});
    }
    if(supabase){await bestEffort(()=>supabase!.rpc('log_usage_event',{p_event_type:'MARKET_ANALYSIS',p_endpoint:'/api/market/analyze',p_success:false,p_duration_ms:Date.now()-startedAt,p_metadata:{}}));await bestEffort(()=>supabase!.rpc('log_system_incident',{p_public_code:'MARKET_ANALYSIS_UNAVAILABLE',p_internal_code:'LIVE_MARKET_ANALYSIS_FAILED',p_provider:'twelvedata',p_endpoint:'/api/market/analyze',p_severity:'WARNING',p_message:error instanceof Error?error.message:'Unknown market analysis failure',p_metadata:{}}))}
    return publicApiError({message:'Market analysis unavailable.',code:'MARKET_ANALYSIS_UNAVAILABLE',internalCode:'LIVE_MARKET_ANALYSIS_FAILED',provider:'twelvedata',endpoint:'/api/market/analyze',error});
  }
}
