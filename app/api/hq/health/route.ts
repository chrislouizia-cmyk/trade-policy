import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {billingConfig,billingEnabled} from '@/lib/billing/config';
import {gmailOAuthConfigured} from '@/lib/server/gmail-delivery';

export const runtime='nodejs';
type Status='operational'|'degraded'|'unavailable'|'not_configured'|'not_monitored';
type Service={status:Status;latencyMs?:number;message:string;budget?:{minuteUsed:number;minuteLimit:number;dailyUsed:number;dailyLimit:number;dailyResetsAt:string;recentOperations:{operation:string;credits:number}[]}};type OperationalStatus='HEALTHY'|'DEGRADED'|'UNAVAILABLE';type OperationalCheck={status:OperationalStatus;count?:number;counts?:Record<string,number>;message:string};
let cached:{expires:number;payload:{checkedAt:string;services:Record<string,Service>;privateBeta:Record<string,OperationalCheck>}}|null=null;
const CACHE_MS=300_000,DEGRADED_MS=2_000,TIMEOUT_MS=5_000;

async function timed<T>(work:(signal:AbortSignal)=>Promise<T>){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);const started=performance.now();try{return{value:await work(controller.signal),latencyMs:Math.round(performance.now()-started)}}finally{clearTimeout(timer)}}
function success(latencyMs:number,message='Connected'):Service{return{status:latencyMs>DEGRADED_MS?'degraded':'operational',latencyMs,message:latencyMs>DEGRADED_MS?'Responding slowly':message}}
function unavailable(error:unknown):Service{return{status:'unavailable',message:error instanceof DOMException&&error.name==='AbortError'?'Health check timed out':'Health check failed'}}

export async function GET(){
  const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {data:allowed,error:permissionError}=await supabase.rpc('has_staff_permission',{p_permission:'system.health'});
  if(permissionError||!allowed)return NextResponse.json({error:'System health permission required.'},{status:403});
  if(cached&&cached.expires>Date.now())return NextResponse.json(cached.payload,{headers:{'Cache-Control':'private, max-age=45'}});

  const services:Record<string,Service>={};
  try{const check=await timed(async()=>{const {error}=await supabase.rpc('current_staff_role');if(error)throw error;return true});services.supabase=success(check.latencyMs)}catch(error){services.supabase=unavailable(error)}
  if(!process.env.TWELVE_DATA_API_KEY)services.twelveData={status:'not_configured',message:'API key is not configured'};
  else try{const admin=createAdminClient(),minute=new Date();minute.setUTCSeconds(0,0);const day=new Date();day.setUTCHours(0,0,0,0);const [minuteResult,dayResult,eventResult]=await Promise.all([admin.from('provider_credit_windows').select('credits_used').eq('provider','twelvedata').eq('window_kind','MINUTE').eq('window_start',minute.toISOString()).maybeSingle(),admin.from('provider_credit_windows').select('credits_used').eq('provider','twelvedata').eq('window_kind','DAY').eq('window_start',day.toISOString()).maybeSingle(),admin.from('provider_credit_events').select('operation,credits').eq('provider','twelvedata').eq('allowed',true).gte('created_at',day.toISOString()).order('created_at',{ascending:false}).limit(250)]);if(minuteResult.error||dayResult.error||eventResult.error)throw minuteResult.error??dayResult.error??eventResult.error;const minuteUsed=Number(minuteResult.data?.credits_used??0),dailyUsed=Number(dayResult.data?.credits_used??0),totals=new Map<string,number>();for(const row of eventResult.data??[])totals.set(row.operation,(totals.get(row.operation)??0)+Number(row.credits));const recentOperations=[...totals].map(([operation,credits])=>({operation,credits})).sort((a,b)=>b.credits-a.credits).slice(0,5);services.twelveData={status:dailyUsed>=800?'degraded':'operational',message:`Credit coordinator active · ${minuteUsed}/8 this minute · ${dailyUsed}/800 today`,budget:{minuteUsed,minuteLimit:8,dailyUsed,dailyLimit:800,dailyResetsAt:new Date(day.getTime()+86_400_000).toISOString(),recentOperations}}}catch(error){services.twelveData={status:'degraded',message:'Provider configured; credit telemetry unavailable'}}
  if(!process.env.OPENAI_API_KEY)services.openAI={status:'not_configured',message:'API key is not configured'};
  else try{const check=await timed(async signal=>{const response=await fetch('https://api.openai.com/v1/models',{signal,headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},cache:'no-store'});if(!response.ok)throw new Error('Provider rejected probe');return true});services.openAI=success(check.latencyMs,'Authenticated API available')}catch(error){services.openAI=unavailable(error)}
  try{const check=await timed(async()=>{const {runDeterministicEngineHealthCheck}=await import('@/lib/server/engine-health-check');return runDeterministicEngineHealthCheck()});services.tradingEngine={...success(check.latencyMs,'Deterministic self-check passed'),status:'operational'}}catch{services.tradingEngine={status:'unavailable',message:'Deterministic self-check failed'}}
  services.email=gmailOAuthConfigured()?{status:'operational',message:'Gmail OAuth delivery is configured'}:{status:'not_configured',message:'Gmail OAuth delivery is not configured'};
  await Promise.all(Object.entries(services).map(([service,value])=>supabase.rpc('staff_record_service_health',{p_service:service,p_status:value.status,p_latency_ms:value.latencyMs??null,p_message:value.message}))).catch(()=>undefined);
  const privateBeta:Record<string,OperationalCheck>={
    supabase:{status:services.supabase.status==='unavailable'?'UNAVAILABLE':services.supabase.status==='degraded'?'DEGRADED':'HEALTHY',message:'Authenticated database health probe'},
    marketDataProvider:{status:services.twelveData.status==='unavailable'?'UNAVAILABLE':services.twelveData.status==='degraded'||services.twelveData.status==='not_configured'?'DEGRADED':'HEALTHY',message:services.twelveData.message},
  };
  try{if(!billingEnabled())privateBeta.billingConfiguration={status:'DEGRADED',message:'Billing is disabled'};else{billingConfig();privateBeta.billingConfiguration={status:'HEALTHY',message:'Required server-side billing configuration is present'}}}catch{privateBeta.billingConfiguration={status:'UNAVAILABLE',message:'Required billing configuration is incomplete'}}
  try{const {data,error}=await createAdminClient().rpc('private_beta_report_operations_summary');if(error)throw error;const backlog=Number(data?.expiredSourceBacklog??0),failures=Number(data?.recentFailureCount??0);privateBeta.historicalReportPersistence={status:'HEALTHY',count:Number(data?.reportCount??0),message:'Historical report storage is available'};privateBeta.expiredSourceBacklog={status:backlog>100?'DEGRADED':'HEALTHY',count:backlog,message:'Expired unsaved sources awaiting cleanup'};privateBeta.recentSanitizedIncidents={status:failures>0?'DEGRADED':'HEALTHY',count:failures,counts:data?.recentFailures??{},message:'Sanitized report incidents in the last 24 hours'}}catch{privateBeta.historicalReportPersistence={status:'UNAVAILABLE',message:'Historical report storage could not be verified'};privateBeta.expiredSourceBacklog={status:'UNAVAILABLE',message:'Expired source backlog could not be read'};privateBeta.recentSanitizedIncidents={status:'UNAVAILABLE',message:'Recent incident counts could not be read'}}
  const payload={checkedAt:new Date().toISOString(),services,privateBeta};cached={expires:Date.now()+CACHE_MS,payload};
  return NextResponse.json(payload,{headers:{'Cache-Control':'private, max-age=45'}});
}
