import {NextResponse} from 'next/server';
import type Stripe from 'stripe';
import {apiError} from '@/lib/server/public-error';
import {billingConfig} from '@/lib/billing/config';
import {stripeClient} from '@/lib/billing/stripe';
import {getValidatedProPrice} from '@/lib/billing/validated-config';
import {createAdminClient} from '@/lib/supabase/admin';
import {resolveCustomerBinding,type CustomerBinding} from '@/lib/billing/webhook-security';
import {isUuid,safeStripeReason,stripeOperationalLog,StripeBillingError,validateSubscriptionPrice,type StripeBillingReason} from '@/lib/billing/stripe-verification';

export const runtime='nodejs';export const dynamic='force-dynamic';
type Admin=ReturnType<typeof createAdminClient>;
type ClaimState='CLAIMED'|'PROCESSING'|'PROCESSED';

function id(value:unknown){return typeof value==='string'?value:value&&typeof value==='object'&&'id' in value?String((value as {id:unknown}).id):null}
function asBinding(row:{user_id:string;stripe_customer_id:string}|null):CustomerBinding|null{return row?{userId:row.user_id,customerId:row.stripe_customer_id}:null}

async function claimEvent(admin:Admin,event:Stripe.Event):Promise<ClaimState>{
  const {data,error}=await admin.rpc('claim_stripe_webhook_event',{p_event_id:event.id,p_event_type:event.type,p_stripe_created_at:new Date(event.created*1000).toISOString(),p_livemode:event.livemode});
  if(error)throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
  if(data==='CLAIMED'||data==='PROCESSING'||data==='PROCESSED')return data;
  throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
}

async function finishEvent(admin:Admin,eventId:string,status:'PROCESSED'|'FAILED',failureCode:StripeBillingReason|null){
  const {error}=await admin.from('stripe_webhook_events').update({processing_status:status,failure_code:failureCode,processed_at:status==='PROCESSED'?new Date().toISOString():null}).eq('event_id',eventId).eq('processing_status','PROCESSING');
  if(error)throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
}

async function bindingFor(admin:Admin,customerId:string,metadataUserId:string|undefined){
  const customerQuery=admin.from('billing_subscriptions').select('user_id,stripe_customer_id').eq('stripe_customer_id',customerId).maybeSingle();
  const userQuery=metadataUserId&&isUuid(metadataUserId)?admin.from('billing_subscriptions').select('user_id,stripe_customer_id').eq('user_id',metadataUserId).maybeSingle():Promise.resolve({data:null,error:null});
  const [customerResult,userResult]=await Promise.all([customerQuery,userQuery]);
  if(customerResult.error||userResult.error)throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
  return resolveCustomerBinding(customerId,metadataUserId,asBinding(customerResult.data),asBinding(userResult.data));
}

async function syncSubscription(admin:Admin,subscription:Stripe.Subscription,event:Stripe.Event){
  const verifiedPrice=await getValidatedProPrice();
  if(event.livemode!==verifiedPrice.livemode)throw new StripeBillingError('STRIPE_MODE_MISMATCH',false);
  const customerId=id(subscription.customer);if(!customerId)throw new StripeBillingError('UNKNOWN_STRIPE_CUSTOMER',false);
  const binding=await bindingFor(admin,customerId,subscription.metadata.tradePoliceUserId);
  try{validateSubscriptionPrice(subscription,verifiedPrice)}catch(error){
    if(error instanceof StripeBillingError&&!binding.initialize){await admin.from('billing_subscriptions').update({plan:'FREE',status:'invalid_price',payment_failed:false,last_webhook_event_id:event.id,last_webhook_created_at:new Date(event.created*1000).toISOString(),updated_at:new Date().toISOString()}).eq('user_id',binding.userId).eq('stripe_customer_id',customerId)}
    throw error;
  }
  const raw=subscription as unknown as Record<string,any>,periodEnd=raw.current_period_end??raw.items?.data?.[0]?.current_period_end;
  const paymentFailed=subscription.status==='past_due'||subscription.status==='unpaid';
  const {error}=await admin.from('billing_subscriptions').upsert({user_id:binding.userId,stripe_customer_id:customerId,stripe_subscription_id:subscription.id,stripe_price_id:verifiedPrice.priceId,stripe_product_id:verifiedPrice.productId,plan:'PRO',status:subscription.status,current_period_end:periodEnd?new Date(periodEnd*1000).toISOString():null,cancel_at_period_end:subscription.cancel_at_period_end,payment_failed:paymentFailed,last_webhook_event_id:event.id,last_webhook_created_at:new Date(event.created*1000).toISOString(),stripe_subscription_created_at:new Date(subscription.created*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
  if(error)throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
}

async function revokeMissingSubscription(admin:Admin,subscriptionId:string,event:Stripe.Event){
  const {error}=await admin.from('billing_subscriptions').update({plan:'FREE',status:'canceled',cancel_at_period_end:false,payment_failed:false,last_webhook_event_id:event.id,last_webhook_created_at:new Date(event.created*1000).toISOString(),updated_at:new Date().toISOString()}).eq('stripe_subscription_id',subscriptionId);
  if(error)throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
}

async function currentSubscription(admin:Admin,subscriptionId:string,event:Stripe.Event,deletedFallback?:Stripe.Subscription){
  try{const subscription=await stripeClient().subscriptions.retrieve(subscriptionId);await syncSubscription(admin,subscription,event)}catch(error){
    const stripeCode=error&&typeof error==='object'&&'code' in error?String((error as {code:unknown}).code):'';
    if(stripeCode==='resource_missing'){if(deletedFallback&&deletedFallback.status==='canceled')await syncSubscription(admin,deletedFallback,event);else await revokeMissingSubscription(admin,subscriptionId,event);return}
    throw error;
  }
}

async function processEvent(admin:Admin,event:Stripe.Event){
  const object=event.data.object as any;
  if(event.type==='checkout.session.completed'){
    const subscriptionId=id(object.subscription);if(subscriptionId)await currentSubscription(admin,subscriptionId,event);
  }else if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)){
    const subscription=object as Stripe.Subscription;await currentSubscription(admin,subscription.id,event,event.type==='customer.subscription.deleted'?subscription:undefined);
  }else if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'){
    const subscriptionId=id(object.subscription??object.parent?.subscription_details?.subscription);if(subscriptionId)await currentSubscription(admin,subscriptionId,event);
  }
}

export async function POST(request:Request){
  const requestId=crypto.randomUUID();let config:ReturnType<typeof billingConfig>;try{config=billingConfig()}catch{stripeOperationalLog('configuration unavailable',{requestId,code:'PRICE_CONFIGURATION_INVALID',retryable:true});return apiError('BILLING_DISABLED','Billing webhook is disabled.',503)}if(!config)return apiError('BILLING_DISABLED','Billing webhook is disabled.',503);
  const signature=request.headers.get('stripe-signature');if(!signature)return apiError('INVALID_SIGNATURE','Stripe signature is required.',400);
  let event:Stripe.Event;try{event=stripeClient().webhooks.constructEvent(await request.text(),signature,config.webhookSecret)}catch{return apiError('INVALID_SIGNATURE','Invalid Stripe webhook signature.',400)}
  const admin=createAdminClient();
  try{
    const claim=await claimEvent(admin,event);if(claim==='PROCESSED')return NextResponse.json({received:true,duplicate:true});if(claim==='PROCESSING')return apiError('WEBHOOK_IN_PROGRESS','Webhook is already processing.',409);
    try{await processEvent(admin,event);await finishEvent(admin,event.id,'PROCESSED',null);return NextResponse.json({received:true})}catch(error){
      const reason=safeStripeReason(error),acknowledge=!reason.retryable;await finishEvent(admin,event.id,acknowledge?'PROCESSED':'FAILED',reason.code);stripeOperationalLog('webhook incident',{requestId,eventId:event.id,eventType:event.type,code:reason.code,retryable:reason.retryable});
      return acknowledge?NextResponse.json({received:true,quarantined:true}):apiError('WEBHOOK_PROCESSING_FAILED','Webhook could not be processed.',500);
    }
  }catch(error){const reason=safeStripeReason(error);stripeOperationalLog('webhook claim failed',{requestId,eventId:event.id,eventType:event.type,code:reason.code,retryable:true});return apiError('WEBHOOK_PROCESSING_FAILED','Webhook could not be processed.',500)}
}
