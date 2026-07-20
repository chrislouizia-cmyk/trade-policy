import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';

export const dynamic='force-dynamic';

const schema=z.object({
  strategyId:z.string().uuid().nullable(),activate:z.boolean(),
  profile:z.record(z.string(),z.unknown()).superRefine((value,ctx)=>{
    if(typeof value.name!=='string'||!value.name.trim())ctx.addIssue({code:z.ZodIssueCode.custom,message:'Strategy name is required.'});
    const ai=value.ai_behavior;
    const threshold=ai&&typeof ai==='object'?Number((ai as Record<string,unknown>).confidenceThreshold):NaN;
    if(!Number.isFinite(threshold)||threshold<0||threshold>100)ctx.addIssue({code:z.ZodIssueCode.custom,message:'AI confidence threshold must be between 0 and 100.'});
    for(const key of ['macro_timeframe','trend_timeframe','confirmation_timeframe','entry_timeframe','trigger_timeframe'])if(typeof value[key]!=='string'||!(value[key] as string).trim())ctx.addIssue({code:z.ZodIssueCode.custom,message:key.replaceAll('_',' ')+' is required.'});
  }),
  instruments:z.array(z.record(z.string(),z.unknown())).min(1),sessions:z.array(z.record(z.string(),z.unknown())),
  rules:z.array(z.record(z.string(),z.unknown())),stopLimits:z.array(z.record(z.string(),z.unknown())),
});

export async function POST(request:Request){
  try{
    const supabase=await createClient();
    const {data:{user},error:authError}=await supabase.auth.getUser();
    if(authError||!user)return apiError('UNAUTHORIZED','Unauthorized.',401);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)return apiError('INVALID_STRATEGY',parsed.error.issues[0]?.message||'Strategy data is invalid.',400,parsed.error.flatten());
    const payload=parsed.data;
    const {data,error}=await supabase.rpc('save_strategy_bundle',{
      p_strategy_id:payload.strategyId,p_profile:payload.profile,p_instruments:payload.instruments,
      p_sessions:payload.sessions,p_rules:payload.rules,p_stop_limits:payload.stopLimits,p_activate:payload.activate,
    });
    if(error)return apiError('STRATEGY_SAVE_FAILED',error.message,500);
    if(!data?.strategyId||data.saved!==true)return apiError('STRATEGY_SAVE_FAILED','Strategy was not returned after saving.',500);
    const modeWrites=payload.rules.map(rule=>supabase.from('strategy_rules').update({evaluation_mode:rule.evaluation_mode==='MANUAL'?'MANUAL':'AUTOMATIC'}).eq('strategy_id',data.strategyId).eq('user_id',user.id).eq('rule_key',String(rule.rule_key??'')));
    const modeResults=await Promise.all(modeWrites);
    const modeError=modeResults.find(result=>result.error)?.error;
    if(modeError)return apiError('RULE_MODE_SAVE_FAILED',modeError.message,500);
    const {data:persisted,error:verifyError}=await supabase.from('strategy_profiles').select('id,name,is_default,engine_version,ai_behavior,macro_timeframe,trend_timeframe,confirmation_timeframe,entry_timeframe,trigger_timeframe').eq('id',data.strategyId).eq('user_id',user.id).single();
    if(verifyError||!persisted)return apiError('STRATEGY_VERIFY_FAILED',verifyError?.message||'Strategy could not be verified after saving.',500);
    return NextResponse.json({...data,strategy:persisted},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const detail=error instanceof Error?error.message:'Unknown persistence error.';
    return apiError('STRATEGY_SAVE_FAILED','Could not save strategy: '+detail,500);
  }
}
