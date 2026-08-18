import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {loadHQStrategyDirectory} from '@/lib/server/hq-strategy-directory';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {data:staffAllowed,error:permissionError}=await supabase.rpc('has_staff_permission',{p_permission:'system.health'});
  if(permissionError)return NextResponse.json({error:'Strategy directory unavailable.'},{status:503});
  const params=new URL(request.url).searchParams,safe=(key:string)=>params.get(key)?.trim().slice(0,120)||undefined;
  try{
    const items=await loadHQStrategyDirectory(createAdminClient(),{q:safe('q'),customer:safe('customer'),instrument:safe('instrument'),methodology:safe('methodology'),status:safe('status'),engineVersion:safe('engineVersion'),health:safe('health'),timeframe:safe('timeframe'),strategyId:safe('strategyId'),ownerId:staffAllowed?undefined:user.id});
    return NextResponse.json({items,total:items.length},{headers:{'Cache-Control':'private, no-store, max-age=0'}});
  }catch(error){console.error('[HQ strategy directory failure]',{message:error instanceof Error?error.message:'Unknown failure',userId:user.id});return NextResponse.json({error:'Strategy directory unavailable.'},{status:503});}
}
