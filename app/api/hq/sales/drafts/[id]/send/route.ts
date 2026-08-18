import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {sendWithGmail} from '@/lib/server/gmail-delivery';

export const dynamic='force-dynamic';

export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;const supabase=await createClient(),{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:'Authentication required.'},{status:401});
  const {data:reserved,error:reserveError}=await supabase.rpc('staff_sales_reserve_draft_send',{p_id:id});
  if(reserveError)return NextResponse.json({error:reserveError.message.includes('already sent')?'This draft was already sent.':reserveError.message.includes('already sending')?'This draft is already being sent.':reserveError.message},{status:reserveError.message.includes('already')?409:400});
  let providerAccepted=false;
  try{
    const delivery=await sendWithGmail({to:reserved.recipient_email,subject:reserved.subject,body:reserved.body});
    providerAccepted=true;
    const {data:draft,error:completeError}=await supabase.rpc('staff_sales_complete_draft_send',{p_id:id,p_provider:delivery.provider,p_provider_message_id:delivery.messageId});
    if(completeError)throw new Error('SEND_PERSISTENCE_FAILED');
    return NextResponse.json({sent:true,draft},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const code=error instanceof Error?error.message:'GMAIL_DELIVERY_FAILED';
    if(!providerAccepted)await supabase.rpc('staff_sales_fail_draft_send',{p_id:id,p_error_code:code});
    const message=providerAccepted?'Gmail accepted the email, but its sent record could not be finalized. The draft remains locked to prevent a duplicate send.':code==='GMAIL_NOT_CONFIGURED'?'Gmail delivery is not configured. The draft was kept intact.':code==='GMAIL_AUTH_FAILED'?'Gmail authorization failed. Reconnect the HQ mail account and try again.':'Email delivery failed. The draft was kept intact; review it and retry.';
    return NextResponse.json({error:message},{status:code==='GMAIL_NOT_CONFIGURED'?503:502});
  }
}
