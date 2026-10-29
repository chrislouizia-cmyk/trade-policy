import {NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {apiError} from '@/lib/server/public-error';
import {billingConfig,normalizeBillingInterval,normalizePublicPlan} from '@/lib/billing/config';
import {stripeClient} from '@/lib/billing/stripe';
import {getBillingState} from '@/lib/billing/entitlements';
import {getStripePriceId,getValidatedPrice} from '@/lib/billing/validated-config';
import {safeStripeReason,stripeOperationalLog,StripeBillingError} from '@/lib/billing/stripe-verification';

export const runtime='nodejs';

export async function POST(request:Request){
  const requestId=crypto.randomUUID();
  try{
    const supabase=await createClient();
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return apiError('UNAUTHORIZED','Sign in before upgrading.',401);

    const formData=await request.json().catch(()=>null);
    const plan=normalizePublicPlan(formData && typeof formData==='object' ? (formData as {plan?:unknown}).plan : null);
    const interval=normalizeBillingInterval(formData && typeof formData==='object' ? (formData as {interval?:unknown}).interval : null);

    if(!plan || !interval)return apiError('INVALID_PLAN_SELECTION','Select a valid public plan and billing interval.',400);

    const config=billingConfig();
    if(!config)return apiError('BILLING_DISABLED','Billing is not available in this environment.',503);

    const priceId=getStripePriceId(plan, interval);
    if(!priceId)return apiError('PRICE_CONFIGURATION_INVALID','This plan and billing interval is not available.',400);

    const verifiedPrice=await getValidatedPrice(plan, interval);
    const state=await getBillingState(user.id);
    if(state.plan===plan)return apiError('ALREADY_SUBSCRIBED',`Your ${plan} subscription is already active.`,409);

    const stripe=stripeClient();
    let customerId=state.stripeCustomerId;
    if(!customerId){
      const customer=await stripe.customers.create({email:user.email,metadata:{tradePoliceUserId:user.id}},{idempotencyKey:`customer:${user.id}`});
      customerId=customer.id;
      const {error}=await createAdminClient().from('billing_subscriptions').upsert({user_id:user.id,stripe_customer_id:customerId,plan:'FREE',status:'inactive'},{onConflict:'user_id'});
      if(error)throw error;
    }

    const session=await stripe.checkout.sessions.create({
      mode:'subscription',
      customer:customerId,
      line_items:[{price:verifiedPrice.priceId,quantity:1}],
      success_url:`${config.appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${config.appUrl}/pricing?checkout=cancelled`,
      client_reference_id:user.id,
      metadata:{tradePoliceUserId:user.id,plan,interval},
      subscription_data:{metadata:{tradePoliceUserId:user.id,plan,interval}},
      allow_promotion_codes:true,
    },{idempotencyKey:`checkout:${user.id}:${plan}:${interval}:${new Date().toISOString().slice(0,13)}`});

    if(!session.url)return apiError('CHECKOUT_UNAVAILABLE','Checkout could not be started.',502);
    return NextResponse.json({url:session.url, plan, interval});
  }catch(error){
    const reason=safeStripeReason(error);
    const status=error instanceof StripeBillingError && !error.retryable ? 400 : 503;
    stripeOperationalLog('checkout failed',{requestId,code:reason.code,retryable:reason.retryable});
    return apiError('CHECKOUT_UNAVAILABLE','Checkout could not be started. No charge was made.',status);
  }
}
