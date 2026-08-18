export type GmailDeliveryRequest=Readonly<{to:string;subject:string;body:string}>;
export type GmailDeliveryResult=Readonly<{provider:'GMAIL';messageId:string|null}>;
export type GmailOAuthConfig=Readonly<{clientId:string;clientSecret:string;refreshToken:string;sender:string}>;
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

const encode=(value:string)=>Buffer.from(value,'utf8').toString('base64url');
const header=(value:string)=>value.replace(/[\r\n]+/g,' ').trim();

export function gmailOAuthConfigFromEnv(env:NodeJS.ProcessEnv=process.env):GmailOAuthConfig|null{
  const clientId=env.GMAIL_CLIENT_ID,clientSecret=env.GMAIL_CLIENT_SECRET,refreshToken=env.GMAIL_REFRESH_TOKEN,sender=env.GMAIL_SENDER_EMAIL;
  return clientId&&clientSecret&&refreshToken&&sender?{clientId,clientSecret,refreshToken,sender}:null;
}
export function gmailOAuthConfigured(env:NodeJS.ProcessEnv=process.env){return gmailOAuthConfigFromEnv(env)!==null;}

/** Refreshes a short-lived access token immediately before a delivery attempt. */
export async function getGmailAccessToken(config:GmailOAuthConfig,fetcher:Fetcher=fetch):Promise<string>{
  const body=new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:'refresh_token'});
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||typeof payload?.access_token!=='string'||!payload.access_token)throw new Error('GMAIL_AUTH_FAILED');
  return payload.access_token;
}

/** Sends through the sole HQ delivery transport. No draft state is changed here. */
export async function sendWithGmail(request:GmailDeliveryRequest,{config=gmailOAuthConfigFromEnv(),fetcher=fetch}:{config?:GmailOAuthConfig|null;fetcher?:Fetcher}={}):Promise<GmailDeliveryResult>{
  if(!config)throw new Error('GMAIL_NOT_CONFIGURED');
  const token=await getGmailAccessToken(config,fetcher);
  const raw=encode(`From: ${header(config.sender)}\r\nTo: ${header(request.to)}\r\nSubject: ${header(request.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${request.body}`);
  const response=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({raw}),cache:'no-store'});
  if(!response.ok){const status=response.status;throw new Error(status===401||status===403?'GMAIL_AUTH_FAILED':'GMAIL_DELIVERY_FAILED');}
  const body=await response.json().catch(()=>null);return {provider:'GMAIL',messageId:typeof body?.id==='string'?body.id:null};
}
