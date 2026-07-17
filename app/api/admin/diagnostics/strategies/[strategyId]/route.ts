import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';

export const dynamic='force-dynamic';

export async function GET(_request:Request,{params}:{params:Promise<{strategyId:string}>}){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {strategyId}=await params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(strategyId))return NextResponse.json({error:'A valid strategy ID is required.'},{status:400});
  const {data,error}=await supabase.rpc('strategy_compatibility_diagnostic',{p_strategy_id:strategyId});
  if(error){
    const denied=error.code==='42501'||/permission|authentication/i.test(error.message);
    const missing=error.code==='P0002'||/not found/i.test(error.message);
    return NextResponse.json({error:denied?'Strategy diagnostic permission denied.':missing?'Strategy not found.':'Strategy diagnostic unavailable.'},{status:denied?403:missing?404:503,headers:{'Cache-Control':'no-store'}});
  }
  return NextResponse.json({diagnostic:data},{headers:{'Cache-Control':'no-store, max-age=0'}});
}
