export type GmailDeliveryRequest=Readonly<{to:string;subject:string;body:string}>;
export type GmailDeliveryResult=Readonly<{provider:'GMAIL';messageId:string|null}>;
export type GmailOAuthConfig=Readonly<{clientId:string;clientSecret:string;refreshToken:string;sender:string}>;
export type GmailDeliveryStage='GMAIL_CONFIG_OK'|'GMAIL_CONFIG_MISSING'|'TOKEN_EXCHANGE_START'|'TOKEN_EXCHANGE_OK'|'GMAIL_SEND_START'|'GMAIL_SEND_ACCEPTED';
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

export class GmailDeliveryError extends Error{
  readonly code:'GMAIL_NOT_CONFIGURED'|'GMAIL_AUTH_FAILED'|'GMAIL_DELIVERY_FAILED';
  readonly externalStatus?:number;
  constructor(code:'GMAIL_NOT_CONFIGURED'|'GMAIL_AUTH_FAILED'|'GMAIL_DELIVERY_FAILED',externalStatus?:number){super(code);this.name='GmailDeliveryError';this.code=code;this.externalStatus=externalStatus;}
}

const encode=(value:string)=>Buffer.from(value,'utf8').toString('base64url');
const header=(value:string)=>value.replace(/[\r\n]+/g,' ').trim();

export function gmailOAuthConfigFromEnv(env:NodeJS.ProcessEnv=process.env):GmailOAuthConfig|null{
  const clientId=env.GMAIL_CLIENT_ID,clientSecret=env.GMAIL_CLIENT_SECRET,refreshToken=env.GMAIL_REFRESH_TOKEN,sender=env.GMAIL_SENDER_EMAIL;
  return clientId&&clientSecret&&refreshToken&&sender?{clientId,clientSecret,refreshToken,sender}:null;
}
export function gmailOAuthConfigured(env:NodeJS.ProcessEnv=process.env){return gmailOAuthConfigFromEnv(env)!==null;}

/** Refreshes a short-lived access token immediately before a delivery attempt. */
export async function getGmailAccessToken(config:GmailOAuthConfig,fetcher:Fetcher=fetch,onStage?:(stage:GmailDeliveryStage,status?:number)=>void):Promise<string>{
  const body=new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'});
  onStage?.('TOKEN_EXCHANGE_START');
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||typeof payload?.access_token!=='string'||!payload.access_token)throw new GmailDeliveryError('GMAIL_AUTH_FAILED',response.status);
  onStage?.('TOKEN_EXCHANGE_OK',response.status);
  return payload.access_token;
}

/** Sends through the sole HQ delivery transport. No draft state is changed here. */
export async function sendWithGmail(request:GmailDeliveryRequest,{config=gmailOAuthConfigFromEnv(),fetcher=fetch,onStage}:{config?:GmailOAuthConfig|null;fetcher?:Fetcher;onStage?:(stage:GmailDeliveryStage,status?:number)=>void}={}):Promise<GmailDeliveryResult>{
  if(!config){onStage?.('GMAIL_CONFIG_MISSING');throw new GmailDeliveryError('GMAIL_NOT_CONFIGURED');}
  onStage?.('GMAIL_CONFIG_OK');
  const token=await getGmailAccessToken(config,fetcher,onStage);
  const raw=encode(`From: ${header(config.sender)}\r\nTo: ${header(request.to)}\r\nSubject: ${header(request.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${request.body}`);
  onStage?.('GMAIL_SEND_START');
  const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),cache:'no-store'});
  if(!response.ok){const status=response.status;throw new GmailDeliveryError(status===401||status===403?'GMAIL_AUTH_FAILED':'GMAIL_DELIVERY_FAILED',status);}
  const body=await response.json().catch(()=>null);onStage?.('GMAIL_SEND_ACCEPTED',response.status);return {provider:'GMAIL',messageId:typeof body?.id==='string'?body.id:null};
}
