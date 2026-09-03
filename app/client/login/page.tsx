import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import Image from 'next/image';
import ClientLoginForm from '@/components/ClientLoginForm';
import { createClient } from '@/lib/supabase/server';
import { getSafeClientNextPath } from '@/lib/auth/safe-next';
import {
  getSupabaseAuthCookieNames,
  hasSupabaseAuthCookieRecoveryFailure,
  isSupabaseAuthRateLimitError,
  shouldAttemptSupabaseCookieRecovery,
} from '@/lib/supabase/auth-cookies';
import {getRequestLocale} from '@/lib/i18n/server';
import {getScreenCopy} from '@/lib/i18n/screen-copy';

function LoginSurface({copy,next,mode}:{copy:ReturnType<typeof getScreenCopy>['auth'];next:string;mode:'login'|'signup'}) {
  return <main className="auth-page client-login-page"><section className="auth-card portal-auth-card"><Image src="/brand/trade-police-logo.png" alt="Trade Police" className="brand-logo-wordmark brand-logo-header" width={220} height={46} priority/><span className="eyebrow">TRADE POLICE</span><h1>{copy.signIn}</h1><p>{copy.customerIntro}</p><ClientLoginForm next={next} initialMode={mode}/></section></main>;
}

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; mode?: string; recovered?: string }>;
}) {
  const params = await searchParams;
  const locale=await getRequestLocale(); const c=getScreenCopy(locale).auth;
  const recovered = params.recovered === '1';
  const safeNext = getSafeClientNextPath(params.next, '/client/login', '/dashboard');
  const cookieStore = await cookies();
  const authCookieNames = getSupabaseAuthCookieNames(cookieStore.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
  const initialMode=params.mode==='signup'?'signup':'login';

  // A new visitor has no session to verify. Rendering now avoids an unnecessary
  // auth round trip and removes the footer-only transition between marketing and signup.
  if(authCookieNames.length===0) return <LoginSurface copy={c} next={safeNext} mode={initialMode}/>;

  const supabase = await createClient();
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user'] | null = null;
  let authError: { status?: number; name?: string; code?: string; message?: string } | null = null;

  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    authError = result.error;
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    authError = {
      name: error.name,
      message: error.message,
      code: /over_request_rate_limit|rate limit|too many requests/i.test(error.message) ? 'over_request_rate_limit' : undefined,
      status: /over_request_rate_limit|rate limit|too many requests/i.test(error.message) ? 429 : undefined,
    };
  }

  const authStateCategory = user ? 'valid' : authError && isSupabaseAuthRateLimitError(authError) ? 'rate_limited' : shouldAttemptSupabaseCookieRecovery({ user, authError, cookieNames: authCookieNames, recovered }) ? 'stale' : 'missing';

  if (recovered) {
    console.info('[AUTH_LOGIN_DIAGNOSTIC]', {
      pathname: '/client/login',
      redirectDestination: '/client/login',
      recovered: true,
      authStateCategory,
      hasMatchingSupabaseAuthCookies: authCookieNames.length > 0,
    });
    return <LoginSurface copy={c} next={safeNext} mode={initialMode}/>;
  }

  if (user) {
    const { data: staffRoute } = await supabase.rpc('staff_workspace_route');
    if (staffRoute) redirect(String(staffRoute));
    redirect(safeNext === '/validate' ? '/dashboard' : safeNext);
  }

  if (hasSupabaseAuthCookieRecoveryFailure({ cookieNames: authCookieNames, recovered })) {
    console.info('[AUTH_RECOVERY_FAILED_TO_CLEAR]', {
      matchingCookieNames: authCookieNames,
      host: (await headers()).get('host'),
      pathname: '/client/login',
    });
  }

  if (authError && isSupabaseAuthRateLimitError(authError)) {
    console.info('[AUTH_LOGIN_DIAGNOSTIC]', {
      pathname: '/client/login',
      redirectDestination: authCookieNames.length > 0 ? '/auth/recover' : '/client/login',
      recovered: false,
      authStateCategory: 'rate_limited',
      hasMatchingSupabaseAuthCookies: authCookieNames.length > 0,
    });

    if (authCookieNames.length > 0) {
      redirect('/auth/recover');
    }
  }

  if (authError && shouldAttemptSupabaseCookieRecovery({ user, authError, cookieNames: authCookieNames, recovered })) {
    console.info('[AUTH_LOGIN_DIAGNOSTIC]', {
      pathname: '/client/login',
      redirectDestination: '/auth/recover',
      recovered: false,
      authStateCategory: 'stale',
      hasMatchingSupabaseAuthCookies: authCookieNames.length > 0,
    });
    redirect('/auth/recover');
  }

  return <LoginSurface copy={c} next={safeNext} mode={initialMode}/>;
}
