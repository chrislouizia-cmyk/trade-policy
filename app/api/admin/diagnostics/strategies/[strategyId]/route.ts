import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {loadHQStrategyDirectory} from '@/lib/server/hq-strategy-directory';

export const dynamic='force-dynamic';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request:Request,{params}:{params:Promise<{strategyId:string}>}){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {strategyId}=await params;if(!UUID.test(strategyId))return NextResponse.json({error:'A valid strategy ID is required.'},{status:400});
  const {data:staffAllowed,error:permissionError}=await supabase.rpc('has_staff_permission',{p_permission:'system.health'});
  if(permissionError)return NextResponse.json({error:'Strategy inspector unavailable.'},{status:503});
  try{const [strategy]=await loadHQStrategyDirectory(createAdminClient(),{strategyId,ownerId:staffAllowed?undefined:user.id});if(!strategy)return NextResponse.json({error:'Strategy not found.'},{status:404});return NextResponse.json({strategy},{headers:{'Cache-Control':'private, no-store, max-age=0'}});}catch(error){console.error('[HQ strategy inspector failure]',{message:error instanceof Error?error.message:'Unknown failure',userId:user.id});return NextResponse.json({error:'Strategy inspector unavailable.'},{status:503});}
}
