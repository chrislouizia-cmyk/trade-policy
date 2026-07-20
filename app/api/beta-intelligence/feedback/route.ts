import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';

const APP_VERSION='1.0.0-beta.21';
const schema=z.object({analysisId:z.string().uuid(),playbookId:z.string().uuid().nullable(),response:z.enum(['EXACTLY','MOSTLY','NOT_REALLY']),category:z.enum(['MISSING_CONFIRMATION','WRONG_INTERPRETATION','MISSING_INDICATOR','RISK_MANAGEMENT','TIMING','OTHER']).nullable(),comment:z.string().max(1000)}).strict().superRefine((value,ctx)=>{if(value.response!=='EXACTLY'&&!value.category)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Feedback category required.'})});

export async function GET(request:Request){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return apiError('UNAUTHORIZED','Unauthorized.',401);
  const analysisId=new URL(request.url).searchParams.get('analysisId');if(!analysisId||!z.string().uuid().safeParse(analysisId).success)return apiError('INVALID_ANALYSIS','Valid analysis ID required.',400);
  const {data,error}=await supabase.rpc('contextual_feedback_eligibility',{p_analysis_id:analysisId});if(error)return apiError('FEEDBACK_ELIGIBILITY_FAILED','Feedback eligibility could not be checked.',500);
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return apiError('UNAUTHORIZED','Unauthorized.',401);
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return apiError('INVALID_CONTEXTUAL_FEEDBACK',parsed.error.issues[0]?.message??'Invalid feedback.',400);
  const value=parsed.data;const {error}=await supabase.rpc('save_contextual_analysis_feedback',{p_analysis_id:value.analysisId,p_playbook_id:value.playbookId,p_response:value.response,p_category:value.category,p_comment:value.comment,p_app_version:APP_VERSION});if(error)return apiError('CONTEXTUAL_FEEDBACK_FAILED','Feedback could not be saved.',500);
  return NextResponse.json({saved:true},{headers:{'Cache-Control':'no-store'}});
}
