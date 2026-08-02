import type Stripe from 'stripe';

export type StripeBillingReason=
  | 'PRICE_CONFIGURATION_INVALID'
  | 'STRIPE_MODE_MISMATCH'
  | 'UNEXPECTED_SUBSCRIPTION_PRICE'
  | 'STRIPE_CUSTOMER_USER_CONFLICT'
  | 'UNKNOWN_STRIPE_CUSTOMER'
  | 'METADATA_USER_MISMATCH'
  | 'STRIPE_REQUEST_FAILED'
  | 'WEBHOOK_PROCESSING_FAILED';

export class StripeBillingError extends Error {
  readonly code:StripeBillingReason;readonly retryable:boolean;
  constructor(code:StripeBillingReason,retryable:boolean){super(code);this.name='StripeBillingError';this.code=code;this.retryable=retryable}
}

export type VerifiedPrice={priceId:string;productId:string;livemode:boolean};

function objectId(value:unknown){return typeof value==='string'?value:value&&typeof value==='object'&&'id' in value?String((value as {id:unknown}).id):null}
function secretMode(secretKey:string){if(secretKey.startsWith('sk_test_'))return false;if(secretKey.startsWith('sk_live_'))return true;return null}

export function validateProPrice(price:Stripe.Price,configuredPriceId:string,secretKey:string):VerifiedPrice{
  const mode=secretMode(secretKey),productId=objectId(price.product),product=typeof price.product==='object'?price.product:null;
  if(mode===null||price.livemode!==mode)throw new StripeBillingError('STRIPE_MODE_MISMATCH',false);
  if(price.id!==configuredPriceId||!price.active||price.type!=='recurring'||price.currency.toLowerCase()!=='usd'||price.unit_amount!==2900||price.recurring?.interval!=='month'||price.recurring.interval_count!==1||!productId||!product||('deleted' in product&&(product as {deleted?:boolean}).deleted))throw new StripeBillingError('PRICE_CONFIGURATION_INVALID',false);
  return {priceId:price.id,productId,livemode:price.livemode};
}

export function validateSubscriptionPrice(subscription:Stripe.Subscription,verified:VerifiedPrice):void{
  const prices=subscription.items.data.map(item=>item.price);
  const exact=prices.find(price=>price.id===verified.priceId);
  if(prices.length!==1||!exact)throw new StripeBillingError('UNEXPECTED_SUBSCRIPTION_PRICE',false);
  const productId=objectId(exact.product);
  if(!exact.active||exact.livemode!==verified.livemode||exact.currency.toLowerCase()!=='usd'||exact.unit_amount!==2900||exact.type!=='recurring'||exact.recurring?.interval!=='month'||exact.recurring.interval_count!==1||productId!==verified.productId)throw new StripeBillingError(exact.livemode!==verified.livemode?'STRIPE_MODE_MISMATCH':'UNEXPECTED_SUBSCRIPTION_PRICE',false);
}

export function safeStripeReason(error:unknown):{code:StripeBillingReason;retryable:boolean}{
  if(error instanceof StripeBillingError)return {code:error.code,retryable:error.retryable};
  return {code:'STRIPE_REQUEST_FAILED',retryable:true};
}

export function stripeOperationalLog(action:string,fields:{requestId:string;eventId?:string;eventType?:string;customerId?:string;subscriptionId?:string;code:StripeBillingReason;retryable:boolean}){
  console.error(`Stripe billing ${action}`,fields);
}

export function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
