import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeClientNextPath } from '../lib/auth/safe-next.ts';
import {
  getSupabaseAuthCookieNames,
  shouldRecoverFromSupabaseAuthError,
  isSupabaseAuthCookieName,
  createSupabaseAuthRecoveryResponse,
  isSupabaseAuthRateLimitError,
  shouldAttemptSupabaseCookieRecovery,
} from '../lib/supabase/auth-cookies.ts';

const blocked = [
  '/login',
  '/client/login',
  '/hq/login',
  '//evil.com',
  'https://evil.com',
  'javascript:alert(1)',
  '/dashboard',
];

test('safe-next rejects self-referential and external destinations', () => {
  for (const value of blocked) {
    const next = getSafeClientNextPath(value, '/login', '/dashboard');
    assert.equal(next, '/dashboard');
  }
});

test('safe-next accepts a valid relative path', () => {
  assert.equal(getSafeClientNextPath('/history', '/client/login', '/dashboard'), '/history');
  assert.equal(getSafeClientNextPath('/account?tab=profile', '/client/login', '/dashboard'), '/account?tab=profile');
});

test('stale-session redirect guard prevents login loop paths', () => {
  const cycle = ['/','/login','/client/login','/dashboard'];
  const sanitized = cycle.map((value) => getSafeClientNextPath(value, '/login', '/dashboard'));
  assert.deepEqual(sanitized, ['/dashboard', '/dashboard', '/dashboard', '/dashboard']);
});

test('no auth loop under stale state can include login pages in the redirect chain', () => {
  const chain = ['/login', '/client/login', '/dashboard'];
  const sanitized = chain.map((path) => getSafeClientNextPath(path, path, '/dashboard'));
  assert.deepEqual(sanitized, ['/dashboard', '/dashboard', '/dashboard']);
  assert.ok(sanitized.every((path) => path !== '/login' && path !== '/client/login'));
});

test('valid session never enters recovery', () => {
  assert.equal(
    shouldRecoverFromSupabaseAuthError({
      user: { id: 'abc' },
      authError: { name: 'AuthSessionMissingError', message: 'session missing' },
      cookieNames: ['sb-project-auth-token'],
    }),
    false,
  );
});

test('no session never enters recovery', () => {
  assert.equal(
    shouldRecoverFromSupabaseAuthError({
      user: undefined,
      authError: null,
      cookieNames: [],
    }),
    false,
  );
});

test('stale cookie enters recovery once', () => {
  const names = ['sb-abc-auth-token'];
  assert.equal(
    shouldRecoverFromSupabaseAuthError({
      user: undefined,
      authError: { name: 'AuthSessionMissingError', code: 'session_not_found', message: 'Session not found' },
      cookieNames: names,
    }),
    true,
  );
  assert.equal(getSupabaseAuthCookieNames(['sb-abc-auth-token'], 'https://abc.supabase.co').length, 1);
  assert.equal(getSupabaseAuthCookieNames(['sb-xyz-auth-token'], 'https://abc.supabase.co').length, 0);
});

test('malformed cookie enters recovery once', () => {
  assert.equal(
    shouldRecoverFromSupabaseAuthError({
      user: undefined,
      authError: { name: 'JWTInvalidError', code: 'auth_invalid_jwt', message: 'Malformed token' },
      cookieNames: ['sb-abc-auth-token'],
    }),
    true,
  );
});

test('chunked stale cookies are all cleared and unrelated cookies survive', () => {
  const names = [
    'sb-abc-auth-token',
    'sb-abc-auth-token.0',
    'sb-abc-auth-token.1',
    'sb-abc-refresh-token',
    'sb-abc-refresh-token.0',
    'other-cookie',
  ];
  const recovered = getSupabaseAuthCookieNames(names, 'https://abc.supabase.co');

  assert.deepEqual(recovered, [
    'sb-abc-auth-token',
    'sb-abc-auth-token.0',
    'sb-abc-auth-token.1',
    'sb-abc-refresh-token',
    'sb-abc-refresh-token.0',
  ]);
  assert.equal(isSupabaseAuthCookieName('sb-abc-auth-token.1', 'https://abc.supabase.co'), true);
  assert.equal(isSupabaseAuthCookieName('other-cookie', 'https://abc.supabase.co'), false);

  const response = createSupabaseAuthRecoveryResponse('https://tradepolice.app', recovered);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  assert.ok(setCookies.some((value) => value.startsWith('sb-abc-auth-token=; Max-Age=0')));
  assert.ok(setCookies.some((value) => value.startsWith('sb-abc-auth-token.1=; Max-Age=0')));
  assert.ok(setCookies.every((value) => !value.startsWith('other-cookie=')));
});

test('auth rate limits are not treated as stale-session recovery triggers', () => {
  const rateLimited = {
    status: 429,
    name: 'AuthApiError',
    code: 'over_request_rate_limit',
    message: 'Request rate limit reached',
  };

  assert.equal(isSupabaseAuthRateLimitError(rateLimited), true);
  assert.equal(shouldRecoverFromSupabaseAuthError({ user: undefined, authError: rateLimited, cookieNames: ['sb-abc-auth-token'] }), false);
  assert.equal(shouldAttemptSupabaseCookieRecovery({ user: undefined, authError: rateLimited, cookieNames: ['sb-abc-auth-token'], recovered: false }), false);
});

test('recovered=1 terminates at login page without another recovery redirect', () => {
  assert.equal(shouldAttemptSupabaseCookieRecovery({ user: undefined, authError: { status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }, cookieNames: ['sb-abc-auth-token'], recovered: '1' }), false);
  assert.equal(shouldAttemptSupabaseCookieRecovery({ user: undefined, authError: { name: 'AuthSessionMissingError', code: 'session_not_found', message: 'Session not found' }, cookieNames: ['sb-abc-auth-token'], recovered: '1' }), false);
});

test('recovery route performs zero auth API calls and only clears cookies', () => {
  const response = createSupabaseAuthRecoveryResponse('https://tradepolice.app', ['sb-abc-auth-token', 'sb-abc-refresh-token']);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  assert.ok(setCookies.length >= 2);
  assert.ok(setCookies.every((value) => value.includes('=;')));
  assert.ok(response.headers.get('location')?.includes('/client/login?next=/dashboard&recovered=1'));
});

test('recovery does not loop and safe-next remains intact', () => {
  assert.equal(getSafeClientNextPath('/client/login', '/auth/recover', '/dashboard'), '/dashboard');
  assert.equal(getSafeClientNextPath('/dashboard', '/auth/recover', '/dashboard'), '/dashboard');
  assert.equal(getSafeClientNextPath('/history', '/auth/recover', '/dashboard'), '/history');
  assert.equal(getSafeClientNextPath('https://evil.com', '/auth/recover', '/dashboard'), '/dashboard');
});
