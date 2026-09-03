import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {loadStrategyById} from '@/lib/server/active-strategy';
import {strategyRevisionId} from '@/lib/historical-decisions/strategy-revision';

export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
    const admin=createAdminClient();const strategy=await loadStrategyById(admin,user.id,id);const revision=strategyRevisionId(strategy);
    const {error:evaluationError}=await admin.rpc('evaluate_marketplace_strategy_candidate',{p_source_strategy_id:id,p_source_strategy_revision_id:revision});
    if(evaluationError)throw evaluationError;
    const [{data:candidate},{data:policy}]=await Promise.all([
      admin.from('marketplace_strategy_candidates').select('*').eq('source_strategy_id',id).eq('source_strategy_revision_id',revision).single(),
      admin.from('marketplace_qualification_policies').select('*').eq('active',true).single(),
    ]);
    return NextResponse.json({candidate,policy,revision},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('[STRATEGY_MARKETPLACE_STATUS_FAILED]',{message:error instanceof Error?error.message:'Unknown error'});return NextResponse.json({error:'Marketplace observation status unavailable.'},{status:503});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
    if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
    const body=await request.json().catch(()=>({}));const candidateId=String(body.candidateId??'');const granted=body.granted===true;
    if(!candidateId)return NextResponse.json({error:'Marketplace candidate is required.'},{status:400});
    const admin=createAdminClient();
    const {data:candidate}=await admin.from('marketplace_strategy_candidates').select('id,source_strategy_revision_id').eq('id',candidateId).eq('source_strategy_id',id).eq('owner_user_id',user.id).maybeSingle();
    if(!candidate)return NextResponse.json({error:'Marketplace candidate not found.'},{status:404});
    const currentStrategy=await loadStrategyById(admin,user.id,id);
    if(strategyRevisionId(currentStrategy)!==candidate.source_strategy_revision_id)return NextResponse.json({error:'This strategy changed. Reload its Marketplace observation before consenting.'},{status:409});
    const {data,error}=await supabase.rpc('set_marketplace_strategy_owner_consent',{p_candidate_id:candidateId,p_granted:granted,p_terms_version:'MARKETPLACE_OWNER_TERMS_V1'});
    if(error)return NextResponse.json({error:'Consent could not be saved in its current state.'},{status:409});
    return NextResponse.json({ok:true,result:data,strategyId:id},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('[STRATEGY_MARKETPLACE_CONSENT_FAILED]',{message:error instanceof Error?error.message:'Unknown error'});return NextResponse.json({error:'Marketplace consent is temporarily unavailable.'},{status:503});}
}
