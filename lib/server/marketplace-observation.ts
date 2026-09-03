import 'server-only';
import {createAdminClient} from '@/lib/supabase/admin';
import {loadStrategyById} from '@/lib/server/active-strategy';
import {strategyRevisionId} from '@/lib/historical-decisions/strategy-revision';
import type {MarketplaceCandidatePreview,MarketplaceQualificationPolicy} from '@/lib/marketplace/contracts';

const numberOrNull=(value:unknown)=>value===null||value===undefined?null:Number(value);

export async function syncMarketplaceCandidates(offset=0,limit=25){
  const admin=createAdminClient();
  const {data:profiles,error,count}=await admin.from('strategy_profiles')
    .select('id,user_id',{count:'exact'}).eq('is_archived',false).order('id').range(offset,offset+limit-1);
  if(error)throw error;
  let synchronized=0;
  const failures:Array<{strategyId:string;reason:string}>=[];
  for(const profile of profiles??[]){
    try{
      const strategy=await loadStrategyById(admin,profile.user_id,profile.id);
      const revision=strategyRevisionId(strategy);
      const {error:evaluateError}=await admin.rpc('evaluate_marketplace_strategy_candidate',{
        p_source_strategy_id:profile.id,p_source_strategy_revision_id:revision,
      });
      if(evaluateError)throw evaluateError;
      synchronized+=1;
    }catch(error){failures.push({strategyId:profile.id,reason:error instanceof Error?error.message:'Evaluation failed'});}
  }
  return {synchronized,failures,total:count??0,nextOffset:offset+(profiles?.length??0),hasMore:offset+(profiles?.length??0)<(count??0)};
}

export async function listMarketplaceCandidates():Promise<MarketplaceCandidatePreview[]>{
  const admin=createAdminClient();
  const [{data:candidates,error:candidateError},{data:policy,error:policyError}]=await Promise.all([
    admin.from('marketplace_strategy_candidates').select('*').order('updated_at',{ascending:false}).limit(500),
    admin.from('marketplace_qualification_policies').select('*').eq('active',true).single(),
  ]);
  if(candidateError)throw candidateError;if(policyError)throw policyError;
  const strategyIds=[...new Set((candidates??[]).map(row=>row.source_strategy_id))];
  const ownerIds=[...new Set((candidates??[]).map(row=>row.owner_user_id))];
  const [{data:strategies},{data:owners}]=await Promise.all([
    strategyIds.length?admin.from('strategy_profiles').select('id,name,instruments').in('id',strategyIds):Promise.resolve({data:[]}),
    ownerIds.length?admin.from('profiles').select('id,display_name').in('id',ownerIds):Promise.resolve({data:[]}),
  ]);
  const strategyMap=new Map((strategies??[]).map(row=>[row.id,row]));
  const ownerMap=new Map((owners??[]).map(row=>[row.id,row.display_name]));
  const p:MarketplaceQualificationPolicy={version:policy.version,minimumObservationDays:policy.minimum_observation_days,minimumClosedTrades:policy.minimum_closed_trades,minimumAdherencePercent:Number(policy.minimum_adherence_percent),maximumCriticalViolations:policy.maximum_critical_violations,maximumDrawdownR:Number(policy.maximum_drawdown_r)};
  return (candidates??[]).map(row=>({
    candidateId:row.id,strategyId:row.source_strategy_id,strategyRevisionId:row.source_strategy_revision_id,
    strategyName:strategyMap.get(row.source_strategy_id)?.name??'Unnamed strategy',ownerName:ownerMap.get(row.owner_user_id)??null,
    instruments:strategyMap.get(row.source_strategy_id)?.instruments??[],status:row.qualification_status,consentStatus:row.owner_consent_status,
    observationDays:row.observation_days,completedBacktests:row.completed_backtests,savedDecisions:row.saved_decisions,closedTrades:row.closed_trades,
    adherencePercent:numberOrNull(row.adherence_percent),criticalViolations:row.critical_violations,maximumDrawdownR:numberOrNull(row.maximum_drawdown_r),policy:p,
  }));
}
