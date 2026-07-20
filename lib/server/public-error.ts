import { NextResponse } from 'next/server';

type PublicErrorOptions = {
  message?: string;
  code?: string;
  status?: number;
  internalCode?: string;
  provider?: string;
  endpoint?: string;
  error?: unknown;
};

export function apiError(code:string,message:string,status:number,details?:unknown){return NextResponse.json({error:{code,message,...(details===undefined?{}:{details})}},{status,headers:{'Cache-Control':'no-store'}})}

export function publicApiError({
  message = 'Trade Police is temporarily unavailable. Please try again shortly.',
  code = 'SERVICE_TEMPORARILY_UNAVAILABLE',
  status = 503,
  internalCode = 'UNHANDLED_SERVER_ERROR',
  provider,
  endpoint,
  error,
}: PublicErrorOptions) {
  console.error(`[${internalCode}]`, {
    provider,
    endpoint,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
  });

  return apiError(code,message,status);
}

export function cleanProviderMessage(status: number) {
  if (status === 429) return 'Analysis capacity is temporarily busy. Please try again in a moment.';
  if (status === 401 || status === 403) return 'Market analysis is temporarily unavailable.';
  return 'Market analysis could not be completed. Your trade data was not changed.';
}
