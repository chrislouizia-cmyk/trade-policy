import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';

const events=['ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED','PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED','METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED','FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED'] as const;
const schema=z.object({eventType:z.enum(events),playbookId:z.string().uuid().nullable(),platform:z.enum(['DESKTOP','MOBILE','TABLET','UNKNOWN']),sessionId:z.string().uuid()}).strict();
const APP_VERSION='1.0.0-beta.21';

export async function POST(request:Request){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return apiError('UNAUTHORIZED','Unauthorized.',401);
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return apiError('INVALID_BETA_EVENT','Invalid Beta Intelligence event.',400);
  const value=parsed.data;
  if(value.eventType==='FIRST_ANALYSIS_COMPLETED')return apiError('DERIVED_EVENT','First-analysis completion is derived from ANALYSIS_COMPLETED.',400);
  const call=value.eventType==='FIRST_ANALYSIS_STARTED'
    ? supabase.rpc('log_beta_analysis_started',{p_playbook_id:value.playbookId,p_app_version:APP_VERSION,p_platform:value.platform,p_session_id:value.sessionId})
    : supabase.rpc('log_beta_intelligence_event',{p_event_type:value.eventType,p_playbook_id:value.playbookId,p_app_version:APP_VERSION,p_platform:value.platform,p_session_id:value.sessionId});
  const {error}=await call;
  if(error)return apiError('BETA_EVENT_FAILED','Beta Intelligence event could not be recorded.',500);
  return NextResponse.json({recorded:true},{headers:{'Cache-Control':'no-store'}});
}
