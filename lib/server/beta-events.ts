import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type ServerBetaEvent='SIGNUP_COMPLETED'|'DECISION_REPORT_SAVED'|'SAVED_REPORT_REOPENED'|'CHECKOUT_COMPLETED';
export async function recordServerBetaEvent(userId:string,eventType:ServerBetaEvent){try{await createAdminClient().rpc('log_server_beta_event',{p_user_id:userId,p_event_type:eventType})}catch{console.error('Beta lifecycle metric was unavailable.',{eventType})}}
