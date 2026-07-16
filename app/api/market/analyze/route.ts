import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildLiveAnalysis } from '@/lib/market-analysis';
import { fetchSeries } from '@/lib/market-data';
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
    const strategy = await loadActiveStrategy(supabase,user.id);
    if (!strategy.instruments.includes(instrument)) return NextResponse.json({ error: 'Instrument is disabled in this strategy.' }, { status: 400 });
    const timeframes = [strategy.trendTimeframe, strategy.confirmationTimeframe, strategy.entryTimeframe];
    const values = await Promise.all(timeframes.map((timeframe) => fetchSeries(instrument, timeframe)));
    const series = Object.fromEntries(timeframes.map((timeframe, index) => [timeframe, values[index]]));
    const analysis = buildLiveAnalysis(instrument, strategy, series, 'Twelve Data');
    const displayName = await getUserDisplayName(supabase, user);
    const structuredAnalysis = analysis as unknown as ChartAnalysis;
    const deterministicCommentary = buildAICommentary(structuredAnalysis, strategy, displayName);
    const aiCommentary = await explainDeterministicAnalysis(structuredAnalysis, deterministicCommentary);
    const enrichedAnalysis = {...analysis, aiCommentary};
    await supabase.from('market_scans').insert({ user_id: user.id, instrument, strategy_profile_id: strategy.id || null, provider: 'twelvedata', timeframes, analysis: enrichedAnalysis });
    await supabase.rpc('log_usage_event',{p_event_type:'MARKET_ANALYSIS',p_endpoint:'/api/market/analyze',p_instrument:instrument,p_success:true,p_duration_ms:Date.now()-startedAt,p_metadata:{provider:'twelvedata'}});
    return NextResponse.json({...enrichedAnalysis,strategyApplied:{id:strategy.id,name:strategy.name}},{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    if(error instanceof StrategyConfigurationError)return NextResponse.json({error:error.message,missingFields:error.missingFields},{status:409});
    if(supabase){await supabase.rpc('log_usage_event',{p_event_type:'MARKET_ANALYSIS',p_endpoint:'/api/market/analyze',p_success:false,p_duration_ms:Date.now()-startedAt,p_metadata:{}});await supabase.rpc('log_system_incident',{p_public_code:'MARKET_ANALYSIS_UNAVAILABLE',p_internal_code:'LIVE_MARKET_ANALYSIS_FAILED',p_provider:'twelvedata',p_endpoint:'/api/market/analyze',p_severity:'WARNING',p_message:error instanceof Error?error.message:'Unknown market analysis failure',p_metadata:{}})}
    return publicApiError({message:'We could not load current market data. Please try again shortly.',code:'MARKET_ANALYSIS_UNAVAILABLE',internalCode:'LIVE_MARKET_ANALYSIS_FAILED',provider:'twelvedata',endpoint:'/api/market/analyze',error});
  }
}
