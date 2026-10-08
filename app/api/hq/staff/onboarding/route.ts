import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';

export const dynamic='force-dynamic';

export async function POST(){
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({ok:false,error:'Authentication required.'},{status:401});
  const {data,error}=await supabase.rpc('accept_staff_invitation_v1');
  if(error)return NextResponse.json({ok:false,error:'Employee onboarding could not be completed.'},{status:400});
  return NextResponse.json({ok:true,route:data?.route??'/hq'},{headers:{'Cache-Control':'private, no-store'}});
}
