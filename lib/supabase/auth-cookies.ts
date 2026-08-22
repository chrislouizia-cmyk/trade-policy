export function getSupabaseProjectRef(url?: string | null): string | null {
  const source = (url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').trim();

  if (!source) return null;

  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
      return null;
    }

    const match = hostname.match(/^([a-z0-9-]+)\.(?:supabase\.co|supabase\.io)$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getSupabaseAuthCookieNames(
  cookieNames: Array<string | { name: string }>,
  url?: string | null,
): string[] {
  const projectRef = getSupabaseProjectRef(url);

  if (!projectRef) {
    return [];
  }

  const pattern = new RegExp(
    `^sb-${escapeRegExp(projectRef)}-(auth-token|auth-token-code-verifier|refresh-token|provider-token)(?:\\.\\d+)?$`,
    'i',
  );

  const names = cookieNames
    .map((entry) => typeof entry === 'string' ? entry : entry.name)
    .filter((name): name is string => Boolean(name));

  return [...new Set(names.filter((name) => pattern.test(name)))];
}

export function getSupabaseAuthCookieNamesFromHeader(
  cookieHeader: string | null | undefined,
  url?: string | null,
): string[] {
  if (!cookieHeader) return [];

  const names = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => pair.split('=')[0]?.trim())
    .filter(Boolean);

  return getSupabaseAuthCookieNames(names, url);
}

export function hasSupabaseAuthCookies(
  cookieHeader: string | null | undefined,
  url?: string | null,
): boolean {
  return getSupabaseAuthCookieNamesFromHeader(cookieHeader, url).length > 0;
}

export function createSupabaseAuthRecoveryResponse(
  origin: string,
  cookieNames: string[],
) {
  const redirect = new URL('/client/login?next=/dashboard&recovered=1', origin);
  const baseResponse = Response.redirect(redirect, 307);
  const headers = new Headers(baseResponse.headers);

  for (const cookieName of cookieNames) {
    for (const variant of getSupabaseAuthCookieDeletionVariants(cookieName, new URL(origin).hostname)) {
      headers.append('Set-Cookie', variant);
    }
  }

  return new Response(baseResponse.body, {
    status: baseResponse.status,
    statusText: baseResponse.statusText,
    headers,
  });
}

export function getSupabaseAuthCookieDeletionVariants(
  cookieName: string,
  host?: string | null,
): string[] {
  const variants = [
    `${cookieName}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure; HttpOnly`,
  ];

  if (!host) return variants;

  const normalizedHost = host.toLowerCase();
  const domainHosts = new Set<string>([normalizedHost]);
  if (!normalizedHost.startsWith('.')) {
    domainHosts.add(`.${normalizedHost}`);
  }

  for (const domain of domainHosts) {
    variants.push(
      `${cookieName}=; Domain=${domain}; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure; HttpOnly`,
    );
  }

  return [...new Set(variants)];
}

export function shouldRecoverFromSupabaseAuthError({
  user,
  authError,
  cookieNames,
}: {
  user?: unknown;
  authError?: { name?: string; code?: string; message?: string } | null;
  cookieNames?: string[];
}) {
  if (user) return false;

  const names = cookieNames ?? [];
  if (!names.length) return false;
  if (!authError) return false;

  const message = authError.message ?? '';
  const code = authError.code ?? '';
  const name = authError.name ?? '';

  const staleSession =
    name === 'AuthSessionMissingError' ||
    name === 'AuthUserMissingError' ||
    code === 'session_not_found' ||
    code === 'invalid_session' ||
    code === 'auth_invalid_jwt' ||
    message.toLowerCase().includes('expired') ||
    message.toLowerCase().includes('invalid') ||
    message.toLowerCase().includes('malformed') ||
    message.toLowerCase().includes('session');

  return staleSession;
}

export function isSupabaseAuthCookieName(name: string, url?: string | null): boolean {
  return getSupabaseAuthCookieNames([name], url).includes(name);
}

export function shouldAttemptSupabaseCookieRecovery({
  user,
  authError,
  cookieNames,
  recovered,
}: {
  user?: unknown;
  authError?: { name?: string; code?: string; message?: string } | null;
  cookieNames?: string[];
  recovered?: boolean | string;
}) {
  if (user) return false;
  if (recovered === true || recovered === '1') return false;
  return shouldRecoverFromSupabaseAuthError({ user, authError, cookieNames });
}

export function hasSupabaseAuthCookieRecoveryFailure({
  cookieNames,
  recovered,
}: {
  cookieNames?: string[];
  recovered?: boolean | string;
}) {
  return (recovered === true || recovered === '1') && (cookieNames ?? []).length > 0;
}
