import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isTradeLifecycleSimulationRecord } from '@/lib/trade-lifecycle-v2-core';

export async function GET(request:Request){
  const client=await createClient();
  const {data:{user}}=await client.auth.getUser();
  const headers={'Cache-Control':'no-store'};
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401,headers});
  const parsed=z.array(z.string().uuid()).min(1).max(20).safeParse(new URL(request.url).searchParams.getAll('id'));
  if(!parsed.success)return NextResponse.json({error:'Invalid evidence selection.'},{status:400,headers});
  const result=await client.from('active_trades').select('id,instrument,direction,status,opened_at,closed_at,result_r,risk_percent,taken_against_verdict,strategy_name_at_entry,strategy_snapshot').eq('user_id',user.id).in('id',parsed.data);
  if(result.error)return NextResponse.json({error:'Evidence unavailable.'},{status:503,headers});
  return NextResponse.json({trades:(result.data??[]).filter(t=>!isTradeLifecycleSimulationRecord(t)).map(t=>({id:t.id,instrument:t.instrument,direction:t.direction,status:t.status,opened_at:t.opened_at,closed_at:t.closed_at,result_r:t.result_r,risk_percent:t.risk_percent,taken_against_verdict:t.taken_against_verdict,strategy_name_at_entry:t.strategy_name_at_entry}))},{headers});
}
