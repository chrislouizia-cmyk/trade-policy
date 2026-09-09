import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {restoreMarketSnapshot,type MarketSnapshotRow} from '@/lib/market-snapshot';
import {apiError} from '@/lib/server/public-error';

export const runtime='nodejs';

export async function GET(request:Request){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return apiError('UNAUTHORIZED','Unauthorized.',401);
  const params=new URL(request.url).searchParams;
  const strategyId=params.get('strategyId');
  const strategyRevisionId=params.get('strategyRevisionId');
  const instrument=params.get('instrument');
  if(!strategyId||!strategyRevisionId||!instrument)return apiError('MARKET_SNAPSHOT_CONTEXT_REQUIRED','The selected strategy, revision and instrument are required.',400);

  const {data,error}=await supabase.from('market_scans')
    .select('id,created_at,strategy_profile_id,strategy_revision_id,instrument,analysis')
    .eq('user_id',user.id).eq('strategy_profile_id',strategyId).eq('strategy_revision_id',strategyRevisionId)
    .eq('instrument',instrument).eq('server_created',true).order('created_at',{ascending:false}).limit(5);
  if(error)return apiError('MARKET_SNAPSHOT_UNAVAILABLE','The previous market check could not be restored.',503);
  const context={strategyId,strategyRevisionId,instrument};
  const snapshot=(data as MarketSnapshotRow[]|null)?.map(row=>restoreMarketSnapshot(row,context)).find(Boolean)??null;
  if(!snapshot)return new NextResponse(null,{status:204,headers:{'Cache-Control':'private, no-store, max-age=0'}});
  return NextResponse.json(snapshot,{headers:{'Cache-Control':'private, no-store, max-age=0'}});
}
