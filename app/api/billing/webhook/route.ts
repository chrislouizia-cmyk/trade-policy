import {NextResponse} from 'next/server';
import type Stripe from 'stripe';
import {apiError} from '@/lib/server/public-error';
import {billingConfig,normalizeBillingInterval,normalizePublicPlan,type PublicPlan} from '@/lib/billing/config';
import {stripeClient} from '@/lib/billing/stripe';
import {getStripePriceId,getValidatedPrice} from '@/lib/billing/validated-config';
import {createAdminClient} from '@/lib/supabase/admin';
import {resolveCustomerBinding,type CustomerBinding} from '@/lib/billing/webhook-security';
import {isUuid,safeStripeReason,stripeOperationalLog,StripeBillingError,validateSubscriptionPrice,type StripeBillingReason} from '@/lib/billing/stripe-verification';
import {recordServerBetaEvent} from '@/lib/server/beta-events';
import {
  affiliateEligibleAmountMinor,
  affiliateInvoicePaidAt,
} from '@/lib/billing/affiliate-invoice';

export const runtime='nodejs';export const dynamic='force-dynamic';
type Admin=ReturnType<typeof createAdminClient>;
type ClaimState='CLAIMED'|'PROCESSING'|'PROCESSED';

function id(value:unknown){return typeof value==='string'?value:value&&typeof value==='object'&&'id' in value?String((value as {id:unknown}).id):null}
function asBinding(row:{user_id:string;stripe_customer_id:string}|null):CustomerBinding|null{return row?{userId:row.user_id,customerId:row.stripe_customer_id}:null}

function resolvePlanAndIntervalFromPriceId(priceId:string | null):{plan:PublicPlan;interval:'monthly'|'annual'}|null{
  if(!priceId)return null;
  for(const plan of ['PRO','ELITE','TEAM'] as const){
    for(const interval of ['monthly','annual'] as const){
      if(getStripePriceId(plan, interval)===priceId)return {plan,interval};
    }
  }
  return null;
}

function resolvePlanFromMetadata(metadata:Record<string,unknown>|undefined):{plan:PublicPlan;interval:'monthly'|'annual'}|null{
  const directPlan=normalizePublicPlan(metadata?.plan);
  const directInterval=normalizeBillingInterval(metadata?.interval);
  if(directPlan&&(directInterval||directPlan)){
    return {plan:directPlan,interval:directInterval ?? 'monthly'};
  }
  const priceId=typeof metadata?.priceId === 'string' ? metadata.priceId : null;
  if(priceId){
    const mapped=resolvePlanAndIntervalFromPriceId(priceId);
    if(mapped)return mapped;
  }
  return null;
}

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
  const priceId=subscription.items.data[0]?.price?.id ?? null;
  const metadataSelection=resolvePlanFromMetadata(subscription.metadata as Record<string,unknown>|undefined);
  const mappedPriceSelection=priceId?resolvePlanAndIntervalFromPriceId(priceId):null;
  const planSelection=metadataSelection ?? mappedPriceSelection;
  if(!planSelection)throw new StripeBillingError('PRICE_CONFIGURATION_INVALID',false);
  const {plan,interval}=planSelection;
  const verifiedPrice=await getValidatedPrice(plan, interval);
  if(event.livemode!==verifiedPrice.livemode)throw new StripeBillingError('STRIPE_MODE_MISMATCH',false);
  const customerId=id(subscription.customer);if(!customerId)throw new StripeBillingError('UNKNOWN_STRIPE_CUSTOMER',false);
  const binding=await bindingFor(admin,customerId,subscription.metadata.tradePoliceUserId);
  try{validateSubscriptionPrice(subscription,verifiedPrice)}catch(error){
    if(error instanceof StripeBillingError&&!binding.initialize){await admin.from('billing_subscriptions').update({plan:'FREE',status:'invalid_price',payment_failed:false,last_webhook_event_id:event.id,last_webhook_created_at:new Date(event.created*1000).toISOString(),updated_at:new Date().toISOString()}).eq('user_id',binding.userId).eq('stripe_customer_id',customerId)}
    throw error;
  }
  const raw=subscription as unknown as Record<string,any>,periodEnd=raw.current_period_end??raw.items?.data?.[0]?.current_period_end;
  const paymentFailed=subscription.status==='past_due'||subscription.status==='unpaid';
  const {error}=await admin.from('billing_subscriptions').upsert({user_id:binding.userId,stripe_customer_id:customerId,stripe_subscription_id:subscription.id,stripe_price_id:verifiedPrice.priceId,stripe_product_id:verifiedPrice.productId,plan,status:subscription.status,current_period_end:periodEnd?new Date(periodEnd*1000).toISOString():null,cancel_at_period_end:subscription.cancel_at_period_end,payment_failed:paymentFailed,last_webhook_event_id:event.id,last_webhook_created_at:new Date(event.created*1000).toISOString(),stripe_subscription_created_at:new Date(subscription.created*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'user_id'});
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


async function recordAffiliateInvoiceCommission(
  admin:Admin,
  invoice:Stripe.Invoice,
  event:Stripe.Event,
){
  const subscriptionId=id(
    (invoice as any).subscription ??
    (invoice as any).parent?.subscription_details?.subscription
  );

  // Affiliate commissions are subscription revenue only.
  if(!subscriptionId)return;

  const customerId=id(invoice.customer);
  if(!customerId)return;

  const binding=await bindingFor(admin,customerId,undefined);

  const {data:referral,error:referralError}=await admin
    .from('affiliate_referrals')
    .select('id,affiliate_id')
    .eq('referred_user_id',binding.userId)
    .maybeSingle();

  if(referralError)throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
  if(!referral)return;

  const eligibleAmountMinor=affiliateEligibleAmountMinor(invoice);

  // A zero-dollar invoice is not a successful paid origin for the
  // affiliate 12-month earning clock.
  if(eligibleAmountMinor<=0)return;

  const paidAt=affiliateInvoicePaidAt(invoice,event.created);

  const {error}=await admin.rpc('record_affiliate_commission',{
    p_affiliate_id:referral.affiliate_id,
    p_referral_id:referral.id,
    p_stripe_invoice_id:invoice.id,
    p_currency:String(invoice.currency ?? '').toUpperCase(),
    p_eligible_amount_minor:eligibleAmountMinor,

    // Legacy compatibility parameters. The database ignores these
    // economic values and calculates the canonical 10% + 12-month
    // eligibility window itself.
    p_commission_amount_minor:0,
    p_eligible_from:paidAt,
    p_eligible_until:null,
    p_hold_until:null,
  });

  if(error){
    // Being outside the fixed first-year earning window is an expected
    // business outcome, not a webhook processing failure.
    if(String(error.message ?? '').includes(
      'AFFILIATE_COMMISSION_OUTSIDE_ELIGIBILITY_WINDOW'
    )){
      return;
    }

    throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
  }

  // Stripe does not guarantee webhook delivery order. If a successful
  // refund arrived before invoice.paid established the commission,
  // reconcile Stripe's current refund truth now.
  await reconcileAffiliateRefundsForInvoice(admin,invoice);
}


async function recordAffiliateStripeAdjustment(
  admin:Admin,
  input:{
    invoiceId:string;
    sourceType:'REFUND'|'CHARGEBACK';
    sourceId:string;
    sourceAmountMinor:number;
    sourceTotalMinor:number;
    reason:string;
    metadata?:Record<string,unknown>;
  },
){
  if(
    !input.invoiceId ||
    !input.sourceId ||
    !Number.isFinite(input.sourceAmountMinor) ||
    input.sourceAmountMinor<=0 ||
    !Number.isFinite(input.sourceTotalMinor) ||
    input.sourceTotalMinor<=0
  ){
    return;
  }

  const {error}=await admin.rpc('record_affiliate_system_adjustment',{
    p_stripe_invoice_id:input.invoiceId,
    p_source_type:input.sourceType,
    p_source_id:input.sourceId,
    p_source_amount_minor:Math.trunc(input.sourceAmountMinor),
    p_source_total_minor:Math.trunc(input.sourceTotalMinor),
    p_reason:input.reason,
    p_metadata:input.metadata ?? {},
  });

  if(error){
    throw new StripeBillingError('WEBHOOK_PROCESSING_FAILED',true);
  }
}

async function invoiceIdForPaymentIntent(
  paymentIntentId:string,
):Promise<string|undefined>{
  const stripe=stripeClient();

  const invoicePayments=await stripe.invoicePayments.list({
    payment:{
      type:'payment_intent',
      payment_intent:paymentIntentId,
    },
    status:'paid',
    limit:10,
  });

  const payment=invoicePayments.data[0];
  return payment ? id(payment.invoice) ?? undefined : undefined;
}

async function reconcileAffiliateRefundsForInvoice(
  admin:Admin,
  invoice:Stripe.Invoice,
){
  const paymentIntentId=id(
    (invoice as any).payment_intent ??
    (invoice as any).payments?.data?.[0]?.payment?.payment_intent
  );

  if(!paymentIntentId)return;

  const stripe=stripeClient();

  const charges=await stripe.charges.list({
    payment_intent:paymentIntentId,
    limit:10,
  });

  for(const charge of charges.data){
    const refunds=await stripe.refunds.list({
      charge:charge.id,
      limit:100,
    });

    for(const refund of refunds.data){
      if(refund.status==='succeeded'){
        await processAffiliateRefund(admin,refund);
      }
    }
  }
}


async function processAffiliateRefund(
  admin:Admin,
  refund:Stripe.Refund,
){
  // A refund is economic truth only after Stripe confirms success.
  // refund.updated may deliver the transition from pending to succeeded.
  if(refund.status!=='succeeded')return;

  const chargeId=id(refund.charge);
  if(!chargeId)return;

  const stripe=stripeClient();
  const charge=await stripe.charges.retrieve(chargeId);
  const paymentIntentId=id(refund.payment_intent) ?? id(charge.payment_intent);
  if(!paymentIntentId)return;

  const invoiceId=await invoiceIdForPaymentIntent(paymentIntentId);

  // Affiliate commissions exist only for subscription invoices.
  if(!invoiceId)return;

  const sourceAmountMinor=
    typeof refund.amount==='number'
      ?Math.max(0,Math.trunc(refund.amount))
      :0;

  const sourceTotalMinor=
    typeof charge.amount==='number'
      ?Math.max(0,Math.trunc(charge.amount))
      :0;

  await recordAffiliateStripeAdjustment(admin,{
    invoiceId,
    sourceType:'REFUND',
    sourceId:refund.id,
    sourceAmountMinor,
    sourceTotalMinor,
    reason:'Stripe refund',
    metadata:{
      charge_id:charge.id,
      refund_id:refund.id,
    },
  });
}

async function processAffiliateLostDispute(
  admin:Admin,
  dispute:Stripe.Dispute,
){
  // An opened dispute is not economic truth. Reverse affiliate
  // commission only after Stripe closes the dispute against us.
  if(dispute.status!=='lost')return;

  const chargeId=id(dispute.charge);
  if(!chargeId)return;

  const stripe=stripeClient();
  const charge=await stripe.charges.retrieve(chargeId);
  const paymentIntentId=id(dispute.payment_intent) ?? id(charge.payment_intent);
  if(!paymentIntentId)return;

  const invoiceId=await invoiceIdForPaymentIntent(paymentIntentId);
  if(!invoiceId)return;

  const sourceAmountMinor=
    typeof dispute.amount==='number'
      ?Math.max(0,Math.trunc(dispute.amount))
      :0;

  const sourceTotalMinor=
    typeof charge.amount==='number'
      ?Math.max(0,Math.trunc(charge.amount))
      :0;

  await recordAffiliateStripeAdjustment(admin,{
    invoiceId,
    sourceType:'CHARGEBACK',
    sourceId:dispute.id,
    sourceAmountMinor,
    sourceTotalMinor,
    reason:'Stripe dispute lost',
    metadata:{
      charge_id:charge.id,
      dispute_id:dispute.id,
      dispute_status:dispute.status,
    },
  });
}

async function processEvent(admin:Admin,event:Stripe.Event){
  const object=event.data.object as any;
  if(event.type==='checkout.session.completed'){
    const subscriptionId=id(object.subscription);if(subscriptionId)await currentSubscription(admin,subscriptionId,event);
  }else if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)){
    const subscription=object as Stripe.Subscription;await currentSubscription(admin,subscription.id,event,event.type==='customer.subscription.deleted'?subscription:undefined);
  }else if(event.type==='invoice.paid'||event.type==='invoice.payment_failed'){
    const subscriptionId=id(object.subscription??object.parent?.subscription_details?.subscription);
    if(subscriptionId)await currentSubscription(admin,subscriptionId,event);

    if(event.type==='invoice.paid'){
      await recordAffiliateInvoiceCommission(
        admin,
        object as Stripe.Invoice,
        event,
      );
    }
  }else if(
    event.type==='refund.created' ||
    event.type==='refund.updated'
  ){
    await processAffiliateRefund(
      admin,
      object as Stripe.Refund,
    );
  }else if(event.type==='charge.dispute.closed'){
    await processAffiliateLostDispute(
      admin,
      object as Stripe.Dispute,
    );
  }
}

export async function POST(request:Request){
  const requestId=crypto.randomUUID();let config:ReturnType<typeof billingConfig>;try{config=billingConfig()}catch{stripeOperationalLog('configuration unavailable',{requestId,code:'PRICE_CONFIGURATION_INVALID',retryable:true});return apiError('BILLING_DISABLED','Billing webhook is disabled.',503)}if(!config)return apiError('BILLING_DISABLED','Billing webhook is disabled.',503);
  const signature=request.headers.get('stripe-signature');if(!signature)return apiError('INVALID_SIGNATURE','Stripe signature is required.',400);
  let event:Stripe.Event;try{event=stripeClient().webhooks.constructEvent(await request.text(),signature,config.webhookSecret)}catch{return apiError('INVALID_SIGNATURE','Invalid Stripe webhook signature.',400)}
  const admin=createAdminClient();
  try{
    const claim=await claimEvent(admin,event);if(claim==='PROCESSED')return NextResponse.json({received:true,duplicate:true});if(claim==='PROCESSING')return apiError('WEBHOOK_IN_PROGRESS','Webhook is already processing.',409);
    try{await processEvent(admin,event);await finishEvent(admin,event.id,'PROCESSED',null);if(event.type==='checkout.session.completed'){const candidate=(event.data.object as {client_reference_id?:unknown}).client_reference_id;if(typeof candidate==='string'&&isUuid(candidate))await recordServerBetaEvent(candidate,'CHECKOUT_COMPLETED')}return NextResponse.json({received:true})}catch(error){
      const reason=safeStripeReason(error),acknowledge=!reason.retryable;await finishEvent(admin,event.id,acknowledge?'PROCESSED':'FAILED',reason.code);stripeOperationalLog('webhook incident',{requestId,eventId:event.id,eventType:event.type,code:reason.code,retryable:reason.retryable});
      return acknowledge?NextResponse.json({received:true,quarantined:true}):apiError('WEBHOOK_PROCESSING_FAILED','Webhook could not be processed.',500);
    }
  }catch(error){const reason=safeStripeReason(error);stripeOperationalLog('webhook claim failed',{requestId,eventId:event.id,eventType:event.type,code:reason.code,retryable:true});return apiError('WEBHOOK_PROCESSING_FAILED','Webhook could not be processed.',500)}
}
