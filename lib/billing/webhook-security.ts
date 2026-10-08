import {isUuid,StripeBillingError} from './stripe-verification.ts';

export type CustomerBinding={userId:string;customerId:string};

export function resolveCustomerBinding(customerId:string,metadataUserId:string|undefined,byCustomer:CustomerBinding|null,byUser:CustomerBinding|null):{userId:string;initialize:boolean}{
  const metadataValid=metadataUserId&&isUuid(metadataUserId)?metadataUserId:null;
  if(byCustomer){
    if(metadataUserId&&metadataValid!==byCustomer.userId)throw new StripeBillingError('METADATA_USER_MISMATCH',false);
    if(byUser&&byUser.customerId!==customerId)throw new StripeBillingError('STRIPE_CUSTOMER_USER_CONFLICT',false);
    return {userId:byCustomer.userId,initialize:false};
  }
  if(!metadataValid)throw new StripeBillingError('UNKNOWN_STRIPE_CUSTOMER',false);
  if(byUser&&byUser.customerId!==customerId)throw new StripeBillingError('STRIPE_CUSTOMER_USER_CONFLICT',false);
  return {userId:metadataValid,initialize:true};
}
