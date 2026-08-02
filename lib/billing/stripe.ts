import 'server-only';import Stripe from 'stripe';import {billingConfig} from './config';
let client:Stripe|undefined;
export function stripeClient(){const config=billingConfig();if(!config)throw new Error('Billing is disabled.');return client??=new Stripe(config.secretKey,{maxNetworkRetries:2});}
