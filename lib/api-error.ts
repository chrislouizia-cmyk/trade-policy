export function apiErrorMessage(value:unknown,fallback:string):string{
  if(!value||typeof value!=='object')return fallback;
  const error=(value as {error?:unknown}).error;
  if(typeof error==='string')return error;
  if(error&&typeof error==='object'&&typeof (error as {message?:unknown}).message==='string')return (error as {message:string}).message;
  return fallback;
}
