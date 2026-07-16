import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';

export const runtime='nodejs';
type Status='operational'|'degraded'|'unavailable'|'not_configured'|'not_monitored';
type Service={status:Status;latencyMs?:number;message:string};
let cached:{expires:number;payload:{checkedAt:string;services:Record<string,Service>}}|null=null;
const CACHE_MS=45_000,DEGRADED_MS=2_000,TIMEOUT_MS=5_000;

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
  else try{const check=await timed(async signal=>{const url=new URL('https://api.twelvedata.com/price');url.searchParams.set('symbol','AAPL');url.searchParams.set('apikey',process.env.TWELVE_DATA_API_KEY!);const response=await fetch(url,{signal,cache:'no-store'});const body=await response.json();if(!response.ok||body.status==='error'||!Number.isFinite(Number(body.price)))throw new Error('Provider rejected probe');return true});services.twelveData=success(check.latencyMs)}catch(error){services.twelveData=unavailable(error)}
  if(!process.env.OPENAI_API_KEY)services.openAI={status:'not_configured',message:'API key is not configured'};
  else try{const check=await timed(async signal=>{const response=await fetch('https://api.openai.com/v1/models',{signal,headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},cache:'no-store'});if(!response.ok)throw new Error('Provider rejected probe');return true});services.openAI=success(check.latencyMs,'Authenticated API available')}catch(error){services.openAI=unavailable(error)}
  try{const check=await timed(async()=>{const {runDeterministicEngineHealthCheck}=await import('@/lib/server/engine-health-check');return runDeterministicEngineHealthCheck()});services.tradingEngine={...success(check.latencyMs,'Deterministic self-check passed'),status:'operational'}}catch{services.tradingEngine={status:'unavailable',message:'Deterministic self-check failed'}}
  services.email={status:'not_configured',message:'No email provider connected'};
  await Promise.all(Object.entries(services).map(([service,value])=>supabase.rpc('staff_record_service_health',{p_service:service,p_status:value.status,p_latency_ms:value.latencyMs??null,p_message:value.message}))).catch(()=>undefined);
  const payload={checkedAt:new Date().toISOString(),services};cached={expires:Date.now()+CACHE_MS,payload};
  return NextResponse.json(payload,{headers:{'Cache-Control':'private, max-age=45'}});
}
