import 'server-only';
export function billingEnabled(){return process.env.BILLING_ENABLED==='true'}
export function billingConfig(){
  if(!billingEnabled())return null;
  const values={secretKey:process.env.STRIPE_SECRET_KEY,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,publishableKey:process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,proPriceId:process.env.STRIPE_PRO_MONTHLY_PRICE_ID,appUrl:process.env.NEXT_PUBLIC_APP_URL};
  const missing=Object.entries(values).filter(([,value])=>!value).map(([key])=>key);
  if(missing.length)throw new Error(`Billing is enabled but configuration is missing: ${missing.join(', ')}`);
  return values as Record<keyof typeof values,string>;
}
