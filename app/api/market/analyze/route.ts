import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildLiveAnalysis, MarketAnalysisError } from '@/lib/market-analysis';
import { fetchSeries, providerSymbol } from '@/lib/market-data';
import { type ChartAnalysis, type Instrument } from '@/types/trade';
import { loadActiveStrategy } from '@/lib/server/active-strategy';
import { publicApiError } from '@/lib/server/public-error';
import { getUserDisplayName } from '@/lib/user-display-name';
import { buildAICommentary } from '@/lib/ai-commentary';
import { explainDeterministicAnalysis } from '@/lib/server/openai-commentary';
import { StrategyConfigurationError } from '@/lib/strategy-policy';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const startedAt=Date.now();
  let supabase: Awaited<ReturnType<typeof createClient>> | null=null;
  try {
    supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { instrument } = await req.json() as { instrument: Instrument };
    if (!instrument) return NextResponse.json({ status: 'DATA_UNAVAILABLE', error: 'An instrument is required.' }, { status: 400 });
    const strategy = await loadActiveStrategy(supabase,user.id);
    if (!strategy.instruments.includes(instrument)) return NextResponse.json({ error: 'Instrument is disabled in this strategy.' }, { status: 400 });
    const timeframes = [strategy.trendTimeframe, strategy.confirmationTimeframe, strategy.entryTimeframe];
    const values = await Promise.all(timeframes.map((timeframe) => fetchSeries(instrument, timeframe)));
    const series = Object.fromEntries(timeframes.map((timeframe, index) => [timeframe, values[index]]));
    const analysis = buildLiveAnalysis(instrument, strategy, series, 'Twelve Data',providerSymbol(instrument));
    const displayName = await getUserDisplayName(supabase, user);
    const structuredAnalysis = analysis as unknown as ChartAnalysis;
    const deterministicCommentary = buildAICommentary(structuredAnalysis, strategy, displayName);
    const aiCommentary = await explainDeterministicAnalysis(structuredAnalysis, deterministicCommentary);
    const enrichedAnalysis = {...analysis, aiCommentary};
    await supabase.from('market_scans').insert({ user_id: user.id, instrument, strategy_profile_id: strategy.id || null, provider: 'twelvedata', timeframes, analysis: enrichedAnalysis });
    await supabase.rpc('log_usage_event',{p_event_type:'MARKET_ANALYSIS',p_endpoint:'/api/market/analyze',p_instrument:instrument,p_success:true,p_duration_ms:Date.now()-startedAt,p_metadata:{provider:'twelvedata'}});
    const diagnostics=process.env.NODE_ENV==='development'?{strategyId:analysis.strategyId,strategySchemaVersion:analysis.strategySchemaVersion,methodologyIds:analysis.methodologyIds,instrument,providerSymbol:analysis.providerSymbol,timeframes,candleCounts:Object.fromEntries(timeframes.map((frame,index)=>[frame,values[index].length])),latestCandleTimestamp:analysis.latestCandleTimestamp,detectorSupportedIds:Object.keys(analysis.evidence).filter(key=>key!=='orderBlock'),evidenceIdsDetected:Object.entries(analysis.evidence).filter(([,value])=>value.value).map(([key])=>key),mandatoryEvidenceIds:[...analysis.breakdown.mandatoryConfirmed,...analysis.breakdown.mandatoryMissing],missingMandatoryIds:analysis.breakdown.mandatoryMissing,unsupportedIds:analysis.breakdown.unsupported,contradictedIds:analysis.breakdown.contradicted,timeframeAligned:analysis.timeframeAligned,confidenceComponents:analysis.components,finalStatus:analysis.status,finalConfidence:analysis.liveAnalysisConfidence,calculationTimestamp:analysis.calculatedAt,cache:'MISS'}:undefined;
    return NextResponse.json({...enrichedAnalysis,strategyApplied:{id:strategy.id,name:strategy.name},diagnostics},{headers:{'Cache-Control':'no-store, max-age=0'}});
  } catch (error) {
    if(error instanceof StrategyConfigurationError)return NextResponse.json({status:'STRATEGY_INCOMPLETE',error:'Strategy configuration incomplete.',missingFields:error.missingFields},{status:409,headers:{'Cache-Control':'no-store'}});
    if(error instanceof MarketAnalysisError){
      const code=error.status==='INSUFFICIENT_DATA'?'INSUFFICIENT_MARKET_DATA':error.status==='ANALYSIS_FAILED'?'STRATEGY_CONFIGURATION_INCOMPLETE':'MARKET_DATA_UNAVAILABLE';
      const message=error.status==='INSUFFICIENT_DATA'?'Insufficient market data.':error.status==='ANALYSIS_FAILED'?'Strategy configuration incomplete.':'Market analysis unavailable.';
      return NextResponse.json({status:error.status,code,error:message},{status:422,headers:{'Cache-Control':'no-store'}});
    }
    if(supabase){await supabase.rpc('log_usage_event',{p_event_type:'MARKET_ANALYSIS',p_endpoint:'/api/market/analyze',p_success:false,p_duration_ms:Date.now()-startedAt,p_metadata:{}});await supabase.rpc('log_system_incident',{p_public_code:'MARKET_ANALYSIS_UNAVAILABLE',p_internal_code:'LIVE_MARKET_ANALYSIS_FAILED',p_provider:'twelvedata',p_endpoint:'/api/market/analyze',p_severity:'WARNING',p_message:error instanceof Error?error.message:'Unknown market analysis failure',p_metadata:{}})}
    return publicApiError({message:'Market analysis unavailable.',code:'MARKET_ANALYSIS_UNAVAILABLE',internalCode:'LIVE_MARKET_ANALYSIS_FAILED',provider:'twelvedata',endpoint:'/api/market/analyze',error});
  }
}
