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
    const [{data:rankings},{data:metrics},{data:events},{data:installs},{data:recipients}]=await Promise.all([
      admin.from('marketplace_release_rankings').select('score_version,performance_score,marketplace_readiness_score,rank_position,calculated_at').eq('release_id',listing.release_id).order('calculated_at',{ascending:false}).limit(1),
      admin.from('marketplace_release_verified_metrics').select('metric_status,observation_days,wins,losses,break_even,win_rate,total_r,average_r,expectancy_r,profit_factor,max_drawdown_r,strategy_adherence_rate,rule_violation_count,approved_trade_count,rejected_or_no_trade_count,updated_at').eq('marketplace_release_id',listing.release_id).order('updated_at',{ascending:false}).limit(1),
      admin.from('marketplace_review_events').select('id,actor_scope,event_type,note,created_at').eq('release_id',listing.release_id).order('created_at',{ascending:false}).limit(50),
      admin.from('marketplace_installs').select('id,installer_user_id,installed_strategy_id,status,created_at').eq('release_id',listing.release_id).order('created_at',{ascending:false}),
      admin.from('profiles').select('id,display_name').order('created_at',{ascending:false}).limit(100),
    ]);
    return NextResponse.json({
      listing:{...sanitizeMarketplaceListing(listing),reviewStatus:listing.review_status,createdAt:listing.created_at,updatedAt:listing.updated_at},
      release:release?{releaseId:release.id,strategyId:release.source_strategy_id,strategyRevisionId:release.source_strategy_revision_id,releaseVersion:release.release_version,sourceType:release.source_type,eligibilityStatus:release.eligibility_status,observationStartedAt:release.observation_started_at,createdAt:release.created_at}:null,
      ranking:rankings?.[0]??null,metrics:metrics?.[0]??null,events:events??[],installs:installs??[],
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
