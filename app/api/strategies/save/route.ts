import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const schema=z.object({
  strategyId:z.string().uuid().nullable(),
  activate:z.boolean(),
  profile:z.record(z.string(),z.unknown()).refine(value=>typeof value.name==='string'&&value.name.trim().length>0,'Strategy name is required.'),
  instruments:z.array(z.record(z.string(),z.unknown())).min(1),
  sessions:z.array(z.record(z.string(),z.unknown())),
  rules:z.array(z.record(z.string(),z.unknown())),
  stopLimits:z.array(z.record(z.string(),z.unknown())),
});

export async function POST(request:Request){
  try{
    const supabase=await createClient();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return NextResponse.json({error:'Unauthorized.'},{status:401});
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message||'Strategy data is invalid.'},{status:400});
    const payload=parsed.data;
    const {data,error}=await supabase.rpc('save_strategy_bundle',{
      p_strategy_id:payload.strategyId,p_profile:payload.profile,p_instruments:payload.instruments,
      p_sessions:payload.sessions,p_rules:payload.rules,p_stop_limits:payload.stopLimits,p_activate:payload.activate,
    });
    if(error)throw new Error(error.message);
    if(!data?.strategyId||data.saved!==true)throw new Error('Strategy was not returned after saving.');
    const {data:persisted,error:verifyError}=await supabase.from('strategy_profiles').select('id,name,is_default').eq('id',data.strategyId).eq('user_id',user.id).single();
    if(verifyError||!persisted)throw new Error(verifyError?.message||'Strategy could not be verified after saving.');
    return NextResponse.json({...data,strategy:persisted},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    return NextResponse.json({error:`Could not save strategy: ${error instanceof Error?error.message:'Unknown persistence error.'}`},{status:500});
  }
}
