import FeedbackTicketQueue from '@/components/hq/FeedbackTicketQueue';
import {getHQContext,HQShell} from '@/lib/hq-page';
export default async function Page(){
  const {supabase,role,displayName,permissions}=await getHQContext('support.view');
  const {data,error}=await supabase.rpc('staff_feedback_queue');
  return <HQShell displayName={displayName} role={role} permissions={permissions}>
    {error?<section className="card"><h1>Feedback queue unavailable</h1><p className="error">{error.message}</p></section>:<FeedbackTicketQueue initialTickets={Array.isArray(data)?data:[]}/>} 
  </HQShell>;
}
