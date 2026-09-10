import {NextResponse} from 'next/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {getHQMarketplaceContext} from '@/lib/server/hq-marketplace';
import {buildMarketplaceEvidence} from '@/lib/server/marketplace-evidence';

export const dynamic='force-dynamic';

export async function GET(_request:Request,{params}:{params:Promise<{candidateId:string}>}){
  try{
    await getHQMarketplaceContext();
    const {candidateId}=await params,admin=createAdminClient();
    const {data:candidate,error}=await admin.from('marketplace_strategy_candidates')
      .select('id,source_strategy_id,source_strategy_revision_id').eq('id',candidateId).single();
    if(error||!candidate)return NextResponse.json({error:'Marketplace candidate not found.'},{status:404});
    const {data:refreshed,error:refreshError}=await admin.rpc('evaluate_marketplace_strategy_candidate',{
      p_source_strategy_id:candidate.source_strategy_id,p_source_strategy_revision_id:candidate.source_strategy_revision_id,
    });
    if(refreshError)throw refreshError;
    const evidence=await buildMarketplaceEvidence(admin,candidate.source_strategy_id,candidate.source_strategy_revision_id);
    return NextResponse.json({
      candidate:{candidateId:refreshed.id,status:refreshed.qualification_status,observationDays:refreshed.observation_days,closedTrades:refreshed.closed_trades,adherencePercent:refreshed.adherence_percent,criticalViolations:refreshed.critical_violations,maximumDrawdownR:refreshed.maximum_drawdown_r,consentStatus:refreshed.owner_consent_status},
      evidence,
    },{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    console.error('[HQ_MARKETPLACE_CANDIDATE_EVIDENCE_FAILED]',{message:error instanceof Error?error.message:'Unknown error'});
    return NextResponse.json({error:'Recorded qualification evidence is temporarily unavailable.'},{status:503});
  }
}
