import {createAdminClient} from '../supabase/admin.ts';
import {MarketDataProviderError,type ProviderCreditTelemetry,type ProviderResult} from '../market-data.ts';

export type ProviderPriority='LIVE'|'INTERACTIVE'|'BACKGROUND';
export type ProviderCreditReservation={allowed:boolean;reason?:string;minuteUsed:number;minuteRemaining:number;dailyUsed:number;dailyRemaining:number;retryAfterSeconds:number;dailyResetsAt:string;duplicate?:boolean;settlementStatus?:string};

export class ProviderCreditLimitError extends Error{
  readonly code='PROVIDER_CREDIT_LIMIT';
  readonly reservation:ProviderCreditReservation;
  constructor(reservation:ProviderCreditReservation){super(reservation.reason==='DAILY_LIMIT'?'The market-data daily credit limit has been reached.':'Market data is waiting for the next provider credit window.');this.name='ProviderCreditLimitError';this.reservation=reservation;}
}

export class ProviderRequestReplayError extends Error{
  readonly code='PROVIDER_REQUEST_REPLAY';
  constructor(){super('This market-data request was already received. Start a new explicit refresh if you want newer data.');this.name='ProviderRequestReplayError';}
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

export async function settleTwelveDataCredits(input:{requestKey:string;actualCredits:number;telemetry?:ProviderCreditTelemetry|null}){
  const {error}=await createAdminClient().rpc('settle_provider_credits',{p_provider:'twelvedata',p_request_key:input.requestKey,
    p_actual_credits:input.actualCredits,p_provider_credits_used:input.telemetry?.creditsUsed??null,
    p_provider_credits_left:input.telemetry?.creditsLeft??null,p_provider_request_credits:input.telemetry?.requestCredits??null});
  if(error)throw new Error(`Provider credit settlement unavailable: ${error.message}`);
}

export async function withTwelveDataCredits<T>(input:{requestKey:string;operation:string;priority:ProviderPriority;credits:number},work:()=>Promise<ProviderResult<T>>):Promise<T>{
  const reservation=await reserveTwelveDataCredits(input);
  if(reservation.duplicate)throw new ProviderRequestReplayError();
  try{
    const result=await work();
    await settleTwelveDataCredits({requestKey:input.requestKey,actualCredits:result.telemetry.requestCredits??input.credits,telemetry:result.telemetry});
    return result.value;
  }catch(error){
    const telemetry=error instanceof MarketDataProviderError?error.telemetry:null;
    // A multi-call bundle can fail after sibling calls already succeeded. Without
    // complete telemetry, retain the full reservation rather than under-counting.
    const actual=input.credits>1?input.credits:(telemetry?.requestCredits??(error instanceof MarketDataProviderError?0:input.credits));
    await settleTwelveDataCredits({requestKey:input.requestKey,actualCredits:actual,telemetry});
    throw error;
  }
}
