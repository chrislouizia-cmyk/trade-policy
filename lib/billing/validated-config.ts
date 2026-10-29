import 'server-only';
import {billingConfig,type BillingInterval,type PublicPlan} from './config';
import {stripeClient} from './stripe';
import {StripeBillingError,validateConfiguredPrice,type VerifiedPrice} from './stripe-verification';

const VALIDATION_TTL_MS=5*60*1000;
const cache=new Map<string,{value:VerifiedPrice;expiresAt:number}>();
const pending=new Map<string,Promise<VerifiedPrice>>();

export function getStripePriceId(plan:PublicPlan, interval:BillingInterval): string | null {
  const config=billingConfig();
  if(!config) return null;
  const map={
    PRO:{ monthly: config.proMonthlyPriceId, annual: config.proAnnualPriceId },
    ELITE:{ monthly: config.eliteMonthlyPriceId, annual: config.eliteAnnualPriceId },
    TEAM:{ monthly: config.teamMonthlyPriceId, annual: config.teamAnnualPriceId },
  } as const satisfies Record<PublicPlan, Record<BillingInterval, string | undefined>>;
  return map[plan][interval] ?? null;
}

export async function getValidatedPrice(plan:PublicPlan, interval:BillingInterval):Promise<VerifiedPrice>{
  const config=billingConfig();
  if(!config)throw new StripeBillingError('PRICE_CONFIGURATION_INVALID',false);
  const priceId=getStripePriceId(plan, interval);
  if(!priceId)throw new StripeBillingError('PRICE_CONFIGURATION_INVALID',false);
  const cacheKey=`${plan}:${interval}`;
  const cached=cache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now())return cached.value;
  const existingPending=pending.get(cacheKey);
  if(existingPending)return existingPending;
  const task=(async()=>{
    const price=await stripeClient().prices.retrieve(priceId,{expand:['product']});
    let value:VerifiedPrice;
    try{value=validateConfiguredPrice(price,priceId,config.secretKey,plan,interval)}catch(error){
      if(error instanceof StripeBillingError)throw new StripeBillingError(error.code,true);
      throw error;
    }
    cache.set(cacheKey,{value,expiresAt:Date.now()+VALIDATION_TTL_MS});
    return value;
  })();
  pending.set(cacheKey,task);
  try{return await task;}finally{pending.delete(cacheKey);}
}

export async function getValidatedProPrice():Promise<VerifiedPrice>{
  return getValidatedPrice('PRO','monthly');
}

export function clearValidatedPriceCache(){
  cache.clear();
  pending.clear();
}

export function clearValidatedProPriceCache(){
  clearValidatedPriceCache();
}
