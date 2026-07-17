import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';

export const dynamic='force-dynamic';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request:Request){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {data:staffAllowed,error:permissionError}=await supabase.rpc('has_staff_permission',{p_permission:'system.health'});
  if(permissionError){console.error('[Strategy selector permission failure]',{code:permissionError.code,userId:user.id});return NextResponse.json({error:'Strategies could not be loaded.'},{status:503})}
  const params=new URL(request.url).searchParams,query=(params.get('q')??'').trim().slice(0,120),page=Math.max(1,Number(params.get('page'))||1),pageSize=20,from=(page-1)*pageSize;
  const strategyId=params.get('strategyId');
  if(strategyId&&!UUID.test(strategyId))return NextResponse.json({error:'Invalid strategy selection.'},{status:400});
  try{
    const admin=createAdminClient();let ownerIds:string[]=[];
    if(staffAllowed&&query){const safe=`%${query.replace(/[%_,().]/g,' ')}%`,{data:owners,error}=await admin.from('profiles').select('id').or(`display_name.ilike.${safe},email.ilike.${safe}`).limit(50);if(error)throw error;ownerIds=(owners??[]).map(owner=>owner.id)}
    let optionsQuery=admin.from('strategy_profiles').select('id,user_id,name,is_default,is_archived,instruments,trading_style',{count:'exact'});
    if(!staffAllowed)optionsQuery=optionsQuery.eq('user_id',user.id);
    if(strategyId)optionsQuery=optionsQuery.eq('id',strategyId);
    if(query&&!strategyId){const safe=`%${query.replace(/[%_,().]/g,' ')}%`,filters=[`name.ilike.${safe}`,`trading_style.ilike.${safe}`];if(/^[a-z0-9:_/-]+$/i.test(query))filters.push(`instruments.cs.{${query.toUpperCase()}}`);if(ownerIds.length)filters.push(`user_id.in.(${ownerIds.join(',')})`);optionsQuery=optionsQuery.or(filters.join(','))}
    const {data:strategies,count,error}=await optionsQuery.order('is_default',{ascending:false}).order('is_archived',{ascending:true}).order('created_at',{ascending:false}).range(from,from+pageSize-1);
    if(error)throw error;
    const userIds=[...new Set((strategies??[]).map(item=>item.user_id))],owners=new Map<string,{display_name:string|null;email:string|null}>();
    if(staffAllowed&&userIds.length){const {data:profiles,error:profileError}=await admin.from('profiles').select('id,display_name,email').in('id',userIds);if(profileError)throw profileError;for(const profile of profiles??[])owners.set(profile.id,profile)}
    const items=(strategies??[]).map(item=>({id:item.id,name:item.name,ownerName:staffAllowed?owners.get(item.user_id)?.display_name??null:null,ownerEmail:staffAllowed?owners.get(item.user_id)?.email??null:null,active:item.is_default,archived:item.is_archived,instruments:item.instruments,tradingStyle:item.trading_style}));
    return NextResponse.json({items,total:count??items.length,page,pageSize},{headers:{'Cache-Control':'private, no-store, max-age=0'}});
  }catch(error){console.error('[Strategy diagnostic options failure]',{message:error instanceof Error?error.message:'Unknown failure',userId:user.id});return NextResponse.json({error:'Strategies could not be loaded.'},{status:503})}
}
