import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { apiError } from '@/lib/server/public-error';

export const dynamic='force-dynamic';
const schema=z.object({sourceDecisionId:z.string().uuid(),idempotencyKey:z.string().trim().min(1).max(100)}).strict();

export async function POST(request:Request){
  try{
    const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
    if(!user)return apiError('UNAUTHORIZED','Your session expired before the report could be saved. Sign in again; the original decision may need to be reopened.',401);
    const parsed=schema.safeParse(await request.json().catch(()=>null));
    if(!parsed.success)return apiError('INVALID_SAVE_REQUEST','The report save request was invalid. Your original decision was not changed.',400);
    const {data,error}=await createAdminClient().rpc('save_decision_report',{p_source_id:parsed.data.sourceDecisionId,p_user_id:user.id,p_idempotency_key:parsed.data.idempotencyKey});
    const saved=Array.isArray(data)?data[0]:data;
    if(error||!saved)throw error??new Error('Report was not saved.');
    return NextResponse.json({reportId:saved.report_id,reportUrl:`/history/${saved.report_id}`,savedAt:saved.created_at,duplicate:Boolean(saved.duplicate)},{headers:{'Cache-Control':'no-store'}});
  }catch(error){console.error('Historical Decision Report save failed:',error instanceof Error?error.message:'unknown');return apiError('REPORT_SAVE_FAILED',"We couldn't save this report. Your decision is still visible and no additional analysis was used. Try again.",503)}
}
