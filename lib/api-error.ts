export function apiErrorMessage(value:unknown,fallback:string):string{
  if(!value||typeof value!=='object')return fallback;
  const error=(value as {error?:unknown}).error;
  if(typeof error==='string')return error;
  if(error&&typeof error==='object'&&typeof (error as {message?:unknown}).message==='string')return (error as {message:string}).message;
  return fallback;
}

export async function readApiResponse(response:Response):Promise<unknown>{
  const contentType=response.headers.get('content-type')||'';
  if(!contentType.includes('application/json'))return null;
  return response.json().catch(()=>null);
}

export function redirectExpiredSession(response:Response,next:string):boolean{
  if(response.status!==401)return false;
  window.location.assign(`/client/login?next=${encodeURIComponent(next)}`);
  return true;
}
