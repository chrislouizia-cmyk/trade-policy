import {createAdminClient} from '../supabase/admin.ts';

export type ProviderPriority='LIVE'|'INTERACTIVE'|'BACKGROUND';
export type ProviderCreditReservation={allowed:boolean;reason?:string;minuteUsed:number;minuteRemaining:number;dailyUsed:number;dailyRemaining:number;retryAfterSeconds:number;dailyResetsAt:string};

export class ProviderCreditLimitError extends Error{
  readonly code='PROVIDER_CREDIT_LIMIT';
  readonly reservation:ProviderCreditReservation;
  constructor(reservation:ProviderCreditReservation){super(reservation.reason==='DAILY_LIMIT'?'The market-data daily credit limit has been reached.':'Market data is waiting for the next provider credit window.');this.name='ProviderCreditLimitError';this.reservation=reservation;}
}

export async function reserveTwelveDataCredits(input:{requestKey?:string;operation:string;priority:ProviderPriority;credits:number}){
  const {data,error}=await createAdminClient().rpc('reserve_provider_credits',{
    p_provider:'twelvedata',p_request_key:input.requestKey??null,p_operation:input.operation,
    p_priority:input.priority,p_credits:input.credits,p_minute_limit:8,p_daily_limit:800,
  });
  if(error)throw new Error(`Provider credit coordinator unavailable: ${error.message}`);
  const value=data as ProviderCreditReservation;
  if(!value?.allowed)throw new ProviderCreditLimitError(value);
  return value;
}
