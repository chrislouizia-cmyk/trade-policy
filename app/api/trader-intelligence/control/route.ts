import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameRequestOrigin } from '@/lib/request-origin';
import { rebuildCollectivePatterns } from '@/lib/server/trader-intelligence-state';
import { processTraderIntelligenceQueue } from '@/lib/server/trader-intelligence-worker';
import { canonicalTraderTimezone } from '@/lib/trader-timezone';

const headers = { 'Cache-Control': 'no-store' };
const settingsSchema = z.object({ collectiveOptIn: z.boolean(), mutedKeys: z.array(z.string().min(1).max(200)).max(30) }).strict();
const experimentSchema = z.object({hypothesis:z.enum(["OVERRIDE","LATE_SESSION"])}).strict();
const memorySchema = z.object({ category: z.enum(['PREFERENCE', 'CORRECTION', 'NOTE']), content: z.string().trim().min(1).max(1000) }).strict();
const timezoneSchema = z.object({timezone:z.string().trim().min(1).max(80)}).strict();
export const maxDuration = 60;

export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({error:'Authentication required.'},{status:401,headers});
  const admin=createAdminClient();
  const [settings, memories, snapshot, queue, profile] = await Promise.all([
    admin.from('trader_intelligence_settings').select('collective_opt_in,muted_keys').eq('user_id',user.id).maybeSingle(),
    admin.from('trader_memories').select('id,category,content,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(30),
    admin.from('trader_learning_snapshots').select('summary,updated_at').eq('user_id',user.id).maybeSingle(),
    admin.from('trader_intelligence_jobs').select('requested_version,completed_version,last_error').eq('user_id',user.id).maybeSingle(),
    admin.from('trader_intelligence_profiles').select('timezone,timezone_source').eq('user_id',user.id).maybeSingle(),
  ]);
  if ([settings,memories,snapshot,queue,profile].some(r=>r.error)) return NextResponse.json({error:'Intelligence unavailable.'},{status:503,headers});
  after(async()=>{try{await processTraderIntelligenceQueue({userId:user.id});}catch{console.warn('[INTELLIGENCE_BACKGROUND_FAILED]');}});
  return NextResponse.json({timezone:profile.data?.timezone??'UTC',timezoneSource:profile.data?.timezone_source??'UNSET',settings:{collectiveOptIn:settings.data?.collective_opt_in===true,mutedKeys:settings.data?.muted_keys??[]},memories:memories.data??[],integral:snapshot.data?.summary?.integral??null,updatedAt:snapshot.data?.updated_at??null,pending:Boolean(queue.data&&queue.data.requested_version>queue.data.completed_version),lastError:queue.data?.last_error??null},{headers});
}

export async function POST(request:Request) {
  if(!isSameRequestOrigin(request))return NextResponse.json({error:'Invalid request origin.'},{status:403,headers});
  const {data:{user}}=await(await createClient()).auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401,headers});
  const body=await request.json().catch(()=>null);
  const settings=settingsSchema.safeParse(body), memory=memorySchema.safeParse(body), experiment=experimentSchema.safeParse(body);
  const admin=createAdminClient();
  const timezone=timezoneSchema.safeParse(body);
  if(timezone.success){
    const canonical=canonicalTraderTimezone(timezone.data.timezone);
    if(!canonical)return NextResponse.json({error:'Invalid timezone.'},{status:400,headers});
    const saved=await admin.from('trader_intelligence_profiles').upsert({user_id:user.id,timezone:canonical,timezone_source:'USER'},{onConflict:'user_id'});
    if(saved.error)return NextResponse.json({error:'Timezone could not be saved.'},{status:503,headers});
    const queued=await admin.from('trader_intelligence_events').insert({user_id:user.id,event_type:'PAGE_VIEW',route:'/account/timezone',context:{}});
    if(queued.error)return NextResponse.json({error:'Timezone saved; intelligence refresh pending.'},{status:503,headers});
  }else if(settings.success){
    const result=await admin.from('trader_intelligence_settings').upsert({user_id:user.id,collective_opt_in:settings.data.collectiveOptIn,muted_keys:[...new Set(settings.data.mutedKeys)],updated_at:new Date().toISOString()});
    if(result.error)return NextResponse.json({error:'Preferences could not be saved.'},{status:503,headers});
    if(!settings.data.collectiveOptIn){
      const deleted=await admin.from('trader_intelligence_contributions').delete().eq('user_id',user.id);
      if(deleted.error)return NextResponse.json({error:'Consent saved; contribution cleanup pending.'},{status:503,headers});
      await rebuildCollectivePatterns(admin);
    }
  }else if(experiment.success){
    const snapshot=await admin.from('trader_learning_snapshots').select('summary').eq('user_id',user.id).maybeSingle();
    if(snapshot.error||!snapshot.data)return NextResponse.json({error:'Refresh your intelligence before starting a study.'},{status:409,headers});
    const result=await admin.from('trader_intelligence_experiments').insert({user_id:user.id,hypothesis:experiment.data.hypothesis,baseline_ids:snapshot.data.summary?.evidenceIds??[],timezone:snapshot.data.summary?.timezone??"UTC"});
    if(result.error)return NextResponse.json({error:result.error.code==='23505'?'This study is already active.':'Study could not be started.'},{status:result.error.code==='23505'?409:503,headers});
  }else if(memory.success){
    const result=await admin.from('trader_memories').insert({user_id:user.id,...memory.data});
    if(result.error)return NextResponse.json({error:'Memory could not be saved.'},{status:503,headers});
  }else return NextResponse.json({error:'Invalid intelligence request.'},{status:400,headers});
  after(async()=>{try{await processTraderIntelligenceQueue({userId:user.id});}catch{console.warn('[INTELLIGENCE_BACKGROUND_FAILED]');}});
  return NextResponse.json({saved:true},{headers});
}

export async function DELETE(request:Request){
  if(!isSameRequestOrigin(request))return NextResponse.json({error:'Invalid request origin.'},{status:403,headers});
  const {data:{user}}=await(await createClient()).auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401,headers});
  const parsed=z.object({memoryId:z.string().uuid()}).strict().safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:'Invalid memory.'},{status:400,headers});
  const result=await createAdminClient().from('trader_memories').delete().eq('id',parsed.data.memoryId).eq('user_id',user.id).select('id');
  if(result.error)return NextResponse.json({error:'Memory could not be deleted.'},{status:503,headers});
  if(!result.data?.length)return NextResponse.json({error:'Memory not found.'},{status:404,headers});
  after(async()=>{try{await processTraderIntelligenceQueue({userId:user.id});}catch{console.warn('[INTELLIGENCE_BACKGROUND_FAILED]');}});
  return NextResponse.json({deleted:true},{headers});
}
