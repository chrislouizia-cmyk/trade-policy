import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordReportFailure, type ReportFailureCode } from '@/lib/historical-decisions/operations';
import { apiError } from '@/lib/server/public-error';
import { recordServerBetaEvent } from '@/lib/server/beta-events';

export const dynamic='force-dynamic';
const schema=z.object({sourceDecisionId:z.string().uuid(),idempotencyKey:z.string().trim().min(1).max(100)}).strict();

export async function POST(request:Request){
  const requestId=crypto.randomUUID();let userId:string|undefined,sourceAnalysisId:string|undefined,failure:ReportFailureCode='UNKNOWN_SAFE_ERROR',retryable=true;
  try{
    const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
    if(!user){await recordReportFailure({reasonCode:'AUTHENTICATION_FAILED',requestId,retryable:false});return apiError('UNAUTHORIZED','Your session expired before the report could be saved. Sign in again; the original decision may need to be reopened.',401)}
    userId=user.id;const parsed=schema.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return apiError('INVALID_SAVE_REQUEST','The report save request was invalid. Your original decision was not changed.',400);
    const admin=createAdminClient();const {data:source,error:sourceError}=await admin.from('decision_report_sources').select('source_analysis_id,expires_at').eq('id',parsed.data.sourceDecisionId).eq('user_id',user.id).maybeSingle();
    if(sourceError){failure='DATABASE_UNAVAILABLE';throw new Error('source lookup unavailable')}
    if(!source){failure='SOURCE_NOT_FOUND';retryable=false;await recordReportFailure({reasonCode:failure,requestId,userId,retryable});return apiError('REPORT_SOURCE_NOT_FOUND','This completed decision is no longer available to save. Run the final risk check again.',409)}
    sourceAnalysisId=source.source_analysis_id;
    if(new Date(source.expires_at).getTime()<=Date.now()){failure='SOURCE_EXPIRED';retryable=false;await recordReportFailure({reasonCode:failure,requestId,userId,sourceAnalysisId,retryable});return apiError('REPORT_SOURCE_EXPIRED','This completed decision expired before it was saved. Run the final risk check again. No additional analysis was used by this save attempt.',409)}
    const {data,error}=await admin.rpc('save_decision_report',{p_source_id:parsed.data.sourceDecisionId,p_user_id:user.id,p_idempotency_key:parsed.data.idempotencyKey});
    const saved=Array.isArray(data)?data[0]:data;
    if(error){failure=error.code==='TP409'?'IDEMPOTENCY_CONFLICT':'DATABASE_UNAVAILABLE';retryable=failure==='DATABASE_UNAVAILABLE';throw new Error('report persistence unavailable')}
    if(!saved){failure='DATABASE_UNAVAILABLE';throw new Error('report persistence unavailable')}
    await recordServerBetaEvent(user.id,'DECISION_REPORT_SAVED');
    return NextResponse.json({reportId:saved.report_id,reportUrl:`/history/${saved.report_id}`,savedAt:saved.created_at,duplicate:Boolean(saved.duplicate)},{headers:{'Cache-Control':'no-store'}});
  }catch{
    console.error('Decision Report save failed.',{requestId,reasonCode:failure,retryable});
    await recordReportFailure({reasonCode:failure,requestId,userId,sourceAnalysisId,retryable});
    const message=failure==='IDEMPOTENCY_CONFLICT'?'This save request was already used for another decision. Your current decision was not changed.':"We couldn't save this report. Your decision is still visible and no additional analysis was used. Try again.";
    return apiError(failure==='IDEMPOTENCY_CONFLICT'?'IDEMPOTENCY_CONFLICT':'REPORT_SAVE_FAILED',message,failure==='IDEMPOTENCY_CONFLICT'?409:503);
  }
}
