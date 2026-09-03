import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {getHQMarketplaceContext} from '@/lib/server/hq-marketplace';
import {syncMarketplaceCandidates} from '@/lib/server/marketplace-observation';

export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{
    await getHQMarketplaceContext();
    const supabase=await createClient();const {data:isOwner}=await supabase.rpc('is_owner');
    if(!isOwner)return NextResponse.json({error:'Founder permission required.'},{status:403});
    const body=await request.json().catch(()=>({}));
    const offset=Math.max(0,Number(body.offset)||0);const result=await syncMarketplaceCandidates(offset,25);
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    console.error('[HQ_MARKETPLACE_SYNC_FAILED]',{message:error instanceof Error?error.message:'Unknown error'});
    return NextResponse.json({error:'Marketplace strategy synchronization failed.'},{status:503});
  }
}
