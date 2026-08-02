'use client';
import {useState} from 'react';
import {apiErrorMessage,readApiResponse,redirectExpiredSession} from '@/lib/api-error';
import {trackBetaEvent} from '@/lib/beta-intelligence';

export default function BillingActions({mode}:{mode:'checkout'|'portal'}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function act(){
    if(busy)return;if(mode==='checkout')void trackBetaEvent('UPGRADE_INITIATED');setBusy(true);setError('');
    const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),15_000);
    try{const response=await fetch(`/api/billing/${mode}`,{method:'POST',signal:controller.signal});const data=await readApiResponse(response);if(redirectExpiredSession(response,'/account'))return;if(!response.ok)throw new Error(apiErrorMessage(data,'Billing is temporarily unavailable. No charge was made.'));if(!data||typeof data!=='object'||typeof (data as {url?:unknown}).url!=='string')throw new Error('Billing returned an invalid response. No charge was made.');window.location.assign((data as {url:string}).url)}
    catch(value){setError(value instanceof Error&&value.name==='AbortError'?'Billing took too long to respond. No charge was made.':value instanceof Error?value.message:'Billing is temporarily unavailable. No charge was made.')}
    finally{window.clearTimeout(timeout);setBusy(false)}
  }
  return <div className="billing-action"><button className="primary" type="button" disabled={busy} onClick={act}>{busy?'Opening…':mode==='checkout'?'Upgrade to Pro':'Manage billing'}</button>{error&&<p className="error">{error}</p>}</div>;
}
