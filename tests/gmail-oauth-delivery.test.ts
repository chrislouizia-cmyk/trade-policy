import assert from 'node:assert/strict';
import test from 'node:test';
import {getGmailAccessToken,gmailOAuthConfigured,sendWithGmail,type GmailOAuthConfig} from '../lib/server/gmail-delivery.ts';

const config:GmailOAuthConfig={clientId:'client',clientSecret:'secret',refreshToken:'refresh',sender:'support@tradepolice.app'};
test('refreshes a server-side Gmail OAuth token before delivery',async()=>{
  const requests:string[]=[];const fetcher=async(input:RequestInfo|URL)=>{requests.push(String(input));return new Response(JSON.stringify({access_token:'fresh-token'}),{status:200});};
  assert.equal(await getGmailAccessToken(config,fetcher),'fresh-token');assert.equal(requests[0],'https://oauth2.googleapis.com/token');
});
test('Gmail send uses the refreshed token and returns the provider message ID',async()=>{
  const requests:Array<{url:string;init?:RequestInit}>=[];const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{requests.push({url:String(input),init});return requests.length===1?new Response(JSON.stringify({access_token:'fresh-token'}),{status:200}):new Response(JSON.stringify({id:'gmail-message-id'}),{status:200});};
  const result=await sendWithGmail({to:'customer@example.com',subject:'Subject',body:'Body'},{config,fetcher});
  assert.deepEqual(result,{provider:'GMAIL',messageId:'gmail-message-id'});assert.equal((requests[1].init?.headers as Record<string,string>).Authorization,'Bearer fresh-token');
});
test('missing OAuth configuration and Gmail failures fail closed',async()=>{
  assert.equal(gmailOAuthConfigured({} as NodeJS.ProcessEnv),false);await assert.rejects(()=>sendWithGmail({to:'a@example.com',subject:'A',body:'B'},{config:null}),/GMAIL_NOT_CONFIGURED/);
  await assert.rejects(()=>getGmailAccessToken(config,async()=>new Response('{}',{status:400})),/GMAIL_AUTH_FAILED/);
  await assert.rejects(()=>sendWithGmail({to:'a@example.com',subject:'A',body:'B'},{config,fetcher:async(input)=>String(input).includes('/token')?new Response(JSON.stringify({access_token:'fresh'}),{status:200}):new Response('{}',{status:500})}),/GMAIL_DELIVERY_FAILED/);
});
test('delivery emits safe stage diagnostics and preserves only external HTTP statuses',async()=>{
  const stages:Array<[string,number|undefined]>=[];
  await sendWithGmail({to:'a@example.com',subject:'A',body:'B'},{config,fetcher:async(input)=>String(input).includes('/token')?new Response(JSON.stringify({access_token:'fresh'}),{status:200}):new Response(JSON.stringify({id:'ok'}),{status:200}),onStage:(stage,status)=>stages.push([stage,status])});
  assert.deepEqual(stages,[['GMAIL_CONFIG_OK',undefined],['TOKEN_EXCHANGE_START',undefined],['TOKEN_EXCHANGE_OK',200],['GMAIL_SEND_START',undefined],['GMAIL_SEND_ACCEPTED',200]]);
  const unavailable:string[]=[];await assert.rejects(()=>sendWithGmail({to:'a@example.com',subject:'A',body:'B'},{config:null,onStage:stage=>unavailable.push(stage)}),/GMAIL_NOT_CONFIGURED/);assert.deepEqual(unavailable,['GMAIL_CONFIG_MISSING']);
});
test('upstream errors carry safe classified code and external status only',async()=>{
  await assert.rejects(async()=>{try{await getGmailAccessToken(config,async()=>new Response('{}',{status:400}));}catch(error:any){assert.equal(error.code,'GMAIL_AUTH_FAILED');assert.equal(error.externalStatus,400);throw error;}},/GMAIL_AUTH_FAILED/);
});
