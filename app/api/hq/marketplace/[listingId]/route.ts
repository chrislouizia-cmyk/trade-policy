import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {getHQMarketplaceContext, sanitizeMarketplaceListing} from '@/lib/server/hq-marketplace';

export const dynamic='force-dynamic';
const transitions:Record<string,string[]>= {DRAFT:['IN_REVIEW','ARCHIVED'],IN_REVIEW:['APPROVED','REJECTED'],APPROVED:['ARCHIVED'],REJECTED:['IN_REVIEW','ARCHIVED'],ARCHIVED:[]};

export async function GET(_request:Request,{params}:{params:Promise<{listingId:string}>}){
  try{
    await getHQMarketplaceContext();const {listingId}=await params;const admin=createAdminClient();
    const {data:listing,error}=await admin.from('marketplace_listings').select('id,release_id,review_status,sanitized_metadata,display_price_cents,creator_share_cents,platform_share_cents,commerce_enabled,created_at,updated_at').eq('id',listingId).single();
    if(error||!listing)return NextResponse.json({error:'Marketplace listing not found.'},{status:404});
    const {data:release}=await admin.from('marketplace_strategy_releases').select('id,source_strategy_id,source_strategy_revision_id,release_version,source_type,minimum_observation_days,eligibility_status,observation_started_at,created_at').eq('id',listing.release_id).single();
    if(release)await admin.rpc('refresh_marketplace_release_verified_metrics',{p_marketplace_release_id:release.id,p_source_strategy_id:release.source_strategy_id,p_source_strategy_revision_id:release.source_strategy_revision_id});
    const [{data:rankings},{data:metrics},{data:events},{data:installs},{data:recipients},{data:verifiedTrades},{count:decisionCount},{data:backtestRuns}]=await Promise.all([
      admin.from('marketplace_release_rankings').select('score_version,performance_score,marketplace_readiness_score,rank_position,calculated_at').eq('release_id',listing.release_id).order('calculated_at',{ascending:false}).limit(1),
      admin.from('marketplace_release_verified_metrics').select('metric_status,observation_days,wins,losses,break_even,win_rate,total_r,average_r,expectancy_r,profit_factor,max_drawdown_r,strategy_adherence_rate,rule_violation_count,approved_trade_count,rejected_or_no_trade_count,updated_at').eq('marketplace_release_id',listing.release_id).order('updated_at',{ascending:false}).limit(1),
      admin.from('marketplace_review_events').select('id,actor_scope,event_type,note,created_at').eq('release_id',listing.release_id).order('created_at',{ascending:false}).limit(50),
      admin.from('marketplace_installs').select('id,installer_user_id,installed_strategy_id,status,created_at').eq('release_id',listing.release_id).order('created_at',{ascending:false}),
      admin.from('profiles').select('id,display_name').order('created_at',{ascending:false}).limit(100),
      admin.from('active_trades').select('id,instrument,outcome,result_r,closed_at,taken_against_verdict,activation_mode').eq('strategy_profile_id',release?.source_strategy_id??'').eq('strategy_revision_id',release?.source_strategy_revision_id??'').eq('status','CLOSED').not('closed_at','is',null).not('result_r','is',null).order('closed_at',{ascending:true}).limit(500),
      admin.from('decision_reports').select('id',{count:'exact',head:true}).eq('strategy_profile_id',release?.source_strategy_id??'').eq('strategy_revision_id',release?.source_strategy_revision_id??''),
      admin.from('backtest_runs').select('id,instrument,execution_timeframe,period_start,period_end,completed_at').eq('strategy_profile_id',release?.source_strategy_id??'').eq('strategy_revision_id',release?.source_strategy_revision_id??'').eq('status','COMPLETED').order('completed_at',{ascending:false}).limit(5),
    ]);
    const runIds=(backtestRuns??[]).map(run=>run.id);
    const {data:backtestResults}=runIds.length?await admin.from('backtest_results').select('run_id,ending_balance,net_return_percent,total_trades,wins,losses,breakeven,win_rate,profit_factor,expectancy_r,average_r,max_drawdown_percent').in('run_id',runIds):{data:[]};
    const trades=(verifiedTrades??[]).map(trade=>({...trade,resultR:Number(trade.result_r)}));
    let cumulativeR=0;let peakR=0;let maxDrawdownR=0;
    const equityCurve=[{index:0,cumulativeR:0},...trades.map((trade,index)=>{cumulativeR+=trade.resultR;peakR=Math.max(peakR,cumulativeR);maxDrawdownR=Math.max(maxDrawdownR,peakR-cumulativeR);return {index:index+1,cumulativeR:Number(cumulativeR.toFixed(4))};})];
    const wins=trades.filter(trade=>trade.resultR>0).length;const losses=trades.filter(trade=>trade.resultR<0).length;const breakeven=trades.length-wins-losses;
    const adherenceCount=trades.filter(trade=>trade.taken_against_verdict!==true).length;
    const resultsByRun=new Map((backtestResults??[]).map(result=>[result.run_id,result]));
    const evidence={
      scope:'EXACT_STRATEGY_REVISION',firstEvidenceAt:trades[0]?.closed_at??null,decisionCount:decisionCount??0,
      live:{tradeCount:trades.length,wins,losses,breakeven,winRate:trades.length?Number(((wins/trades.length)*100).toFixed(2)):null,totalR:Number(cumulativeR.toFixed(4)),averageR:trades.length?Number((cumulativeR/trades.length).toFixed(4)):null,maxDrawdownR:Number(maxDrawdownR.toFixed(4)),adherencePercent:trades.length?Number(((adherenceCount/trades.length)*100).toFixed(2)):null,equityCurve,recentTrades:trades.slice(-20).reverse().map(trade=>({id:trade.id,instrument:trade.instrument,outcome:trade.outcome,resultR:trade.resultR,closedAt:trade.closed_at,activationMode:trade.activation_mode,followedVerdict:trade.taken_against_verdict!==true}))},
      backtests:(backtestRuns??[]).map(run=>({...run,result:resultsByRun.get(run.id)??null})),
    };
    return NextResponse.json({
      listing:{...sanitizeMarketplaceListing(listing),reviewStatus:listing.review_status,createdAt:listing.created_at,updatedAt:listing.updated_at},
      release:release?{releaseId:release.id,strategyId:release.source_strategy_id,strategyRevisionId:release.source_strategy_revision_id,releaseVersion:release.release_version,sourceType:release.source_type,eligibilityStatus:release.eligibility_status,observationStartedAt:release.observation_started_at,createdAt:release.created_at}:null,
      ranking:rankings?.[0]??null,metrics:metrics?.[0]??null,evidence,events:events??[],installs:installs??[],
      recipients:(recipients??[]).map(row=>({id:row.id,name:row.display_name||`Customer ${String(row.id).slice(0,8)}`})),
      allowedTransitions:transitions[listing.review_status]??[],
    },{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('[HQ_MARKETPLACE_DETAIL_FAILED]',{message:error instanceof Error?error.message:'Unknown error'});return NextResponse.json({error:'Marketplace release detail unavailable.'},{status:503});}
}

export async function PATCH(request:Request,{params}:{params:Promise<{listingId:string}>}){
  try{
    const context=await getHQMarketplaceContext();const {listingId}=await params;
    const canReview=context.permissions.includes('compliance.view')||Boolean((await context.supabase.rpc('is_owner')).data);
    if(!canReview)return NextResponse.json({error:'Compliance review permission required.'},{status:403});
    const body=await request.json().catch(()=>({}));const next=String(body.reviewStatus??'');const note=typeof body.note==='string'?body.note.trim().slice(0,1000):'';
    const admin=createAdminClient();const {data:current}=await admin.from('marketplace_listings').select('release_id,review_status').eq('id',listingId).single();
    if(!current)return NextResponse.json({error:'Marketplace listing not found.'},{status:404});
    if(!(transitions[current.review_status]??[]).includes(next))return NextResponse.json({error:`Transition from ${current.review_status} to ${next} is not allowed.`},{status:409});
    if((next==='APPROVED'||next==='REJECTED')&&!note)return NextResponse.json({error:'A review note is required.'},{status:400});
    const {error:transitionError}=await admin.rpc('staff_marketplace_transition_listing',{
      p_listing_id:listingId,p_review_status:next,p_note:note,p_actor_user_id:context.user.id,
    });
    if(transitionError)throw transitionError;
    return NextResponse.json({ok:true,reviewStatus:next},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('[HQ_MARKETPLACE_REVIEW_FAILED]',{message:error instanceof Error?error.message:'Unknown error'});return NextResponse.json({error:'Marketplace review could not be saved.'},{status:503});}
}
