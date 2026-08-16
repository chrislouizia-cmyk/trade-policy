import type Stripe from 'stripe';
import type {PublicPlan,BillingInterval} from './config';

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

export type VerifiedPrice={
  priceId:string;
  productId:string;
  livemode:boolean;
  plan:PublicPlan;
  interval:BillingInterval;
  amount:number;
};

function objectId(value:unknown){return typeof value==='string'?value:value&&typeof value==='object'&&'id' in value?String((value as {id:unknown}).id):null}
function secretMode(secretKey:string){if(secretKey.startsWith('sk_test_'))return false;if(secretKey.startsWith('sk_live_'))return true;return null}

const EXPECTED_PUBLIC_PRICE_CONTRACT: Record<PublicPlan, Record<BillingInterval, {amount:number;interval:'month'|'year';currency:'usd'}>> = {
  PRO:{ monthly:{amount:2900,interval:'month',currency:'usd'}, annual:{amount:27900,interval:'year',currency:'usd'} },
  ELITE:{ monthly:{amount:5900,interval:'month',currency:'usd'}, annual:{amount:56900,interval:'year',currency:'usd'} },
  TEAM:{ monthly:{amount:14900,interval:'month',currency:'usd'}, annual:{amount:142900,interval:'year',currency:'usd'} },
};

export function getExpectedPriceContract(plan:PublicPlan, interval:BillingInterval){
  return EXPECTED_PUBLIC_PRICE_CONTRACT[plan][interval];
}

export function validateConfiguredPrice(
  price:Stripe.Price,
  configuredPriceId:string,
  secretKey:string,
  expectedPlan:PublicPlan,
  expectedInterval:BillingInterval,
):VerifiedPrice{
  const mode=secretMode(secretKey),productId=objectId(price.product),product=typeof price.product==='object'?price.product:null;
  const expected = getExpectedPriceContract(expectedPlan, expectedInterval);

  if(mode===null||price.livemode!==mode)throw new StripeBillingError('STRIPE_MODE_MISMATCH',false);
  if(price.id!==configuredPriceId||!price.active||price.type!=='recurring'||price.currency.toLowerCase()!==expected.currency||price.unit_amount!==expected.amount||price.recurring?.interval!==expected.interval||price.recurring.interval_count!==1||!productId||!product||('deleted' in product&&(product as {deleted?:boolean}).deleted))throw new StripeBillingError('PRICE_CONFIGURATION_INVALID',false);

  return {priceId:price.id,productId,livemode:price.livemode,plan:expectedPlan,interval:expectedInterval,amount:expected.amount};
}

export function validateProPrice(price:Stripe.Price,configuredPriceId:string,secretKey:string):VerifiedPrice{
  return validateConfiguredPrice(price,configuredPriceId,secretKey,'PRO','monthly');
}

export function validateSubscriptionPrice(subscription:Stripe.Subscription,verified:VerifiedPrice):void{
  const prices=subscription.items.data.map(item=>item.price);
  const exact=prices.find(price=>price.id===verified.priceId);
  if(prices.length!==1||!exact)throw new StripeBillingError('UNEXPECTED_SUBSCRIPTION_PRICE',false);
  const expected=getExpectedPriceContract(verified.plan, verified.interval);
  const productId=objectId(exact.product);
  if(!exact.active||exact.livemode!==verified.livemode||exact.currency.toLowerCase()!==expected.currency||exact.unit_amount!==expected.amount||exact.type!=='recurring'||exact.recurring?.interval!==expected.interval||exact.recurring.interval_count!==1||productId!==verified.productId)throw new StripeBillingError(exact.livemode!==verified.livemode?'STRIPE_MODE_MISMATCH':'UNEXPECTED_SUBSCRIPTION_PRICE',false);
}

export function safeStripeReason(error:unknown):{code:StripeBillingReason;retryable:boolean}{
  if(error instanceof StripeBillingError)return {code:error.code,retryable:error.retryable};
  return {code:'STRIPE_REQUEST_FAILED',retryable:true};
}

export function stripeOperationalLog(action:string,fields:{requestId:string;eventId?:string;eventType?:string;customerId?:string;subscriptionId?:string;code:StripeBillingReason;retryable:boolean}){
  console.error(`Stripe billing ${action}`,fields);
}

export function isUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)}
