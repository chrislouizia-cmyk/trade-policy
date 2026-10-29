import FeedbackTicketQueue from '@/components/hq/FeedbackTicketQueue';
import SupportTicketQueue from '@/components/hq/SupportTicketQueue';
import {getHQContext,HQShell} from '@/lib/hq-page';
export default async function Page(){
  const {supabase,role,displayName,permissions}=await getHQContext('support.view');
  const canViewFeedback=permissions.includes('feedback.view');
  const [ticketResult,feedbackResult]=await Promise.all([
    supabase.rpc('staff_support_queue'),
    canViewFeedback?supabase.rpc('staff_feedback_queue'):Promise.resolve(null),
  ]);
  return <HQShell displayName={displayName} role={role} permissions={permissions}>
    <div className="stack">
      {ticketResult.error
        ? <section className="card"><h1>Support queue unavailable</h1><p className="error">Support tickets could not be loaded. No ticket totals were assumed.</p></section>
        : <SupportTicketQueue initialTickets={Array.isArray(ticketResult.data)?ticketResult.data:[]} canManage={permissions.includes('support.manage')}/>}
      {canViewFeedback ? feedbackResult?.error?<section className="card"><h2>Feedback queue unavailable</h2><p className="error">Feedback could not be loaded. No feedback totals were assumed.</p></section>:<FeedbackTicketQueue initialTickets={Array.isArray(feedbackResult?.data)?feedbackResult.data:[]} canManage={permissions.includes('support.manage')}/> : null}
    </div>
  </HQShell>;
}
