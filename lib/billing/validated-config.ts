import 'server-only';
import {billingConfig} from './config';
import {stripeClient} from './stripe';
import {StripeBillingError,validateProPrice,type VerifiedPrice} from './stripe-verification';

const VALIDATION_TTL_MS=5*60*1000;
let cached:{value:VerifiedPrice;expiresAt:number}|null=null;
let pending:Promise<VerifiedPrice>|null=null;

export async function getValidatedProPrice():Promise<VerifiedPrice>{
  const config=billingConfig();if(!config)throw new StripeBillingError('PRICE_CONFIGURATION_INVALID',false);
  if(cached&&cached.expiresAt>Date.now())return cached.value;
  if(pending)return pending;
  pending=(async()=>{const price=await stripeClient().prices.retrieve(config.proPriceId,{expand:['product']});let value:VerifiedPrice;try{value=validateProPrice(price,config.proPriceId,config.secretKey)}catch(error){if(error instanceof StripeBillingError)throw new StripeBillingError(error.code,true);throw error}cached={value,expiresAt:Date.now()+VALIDATION_TTL_MS};return value})().finally(()=>{pending=null});
  return pending;
}

export function clearValidatedProPriceCache(){cached=null;pending=null}
