import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { apiError } from '@/lib/server/public-error';

const schema=z.object({strategyId:z.string().uuid(),confirmation:z.literal('DELETE')});

export async function POST(request:Request){
  const supabase=await createClient();
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)return apiError('UNAUTHORIZED','Unauthorized.',401);
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return apiError('DELETE_CONFIRMATION_REQUIRED','Type DELETE to confirm permanent playbook deletion.',400);
  const {data,error}=await supabase.rpc('delete_strategy_playbook',{p_strategy_id:parsed.data.strategyId});
  if(error)return apiError('PLAYBOOK_DELETE_FAILED',error.message,400);
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
}
