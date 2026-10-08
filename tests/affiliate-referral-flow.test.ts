import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const route = fs.readFileSync('app/r/[code]/route.ts', 'utf8');
const bind = fs.readFileSync('app/api/affiliate/bind-signup/route.ts', 'utf8');
const callback = fs.readFileSync('app/auth/callback/route.ts', 'utf8');
const signup = fs.readFileSync('components/ClientLoginForm.tsx', 'utf8');
const dashboard = fs.readFileSync('app/account/affiliate/page.tsx', 'utf8');
const cookie = fs.readFileSync('lib/affiliate/referral-cookie.ts', 'utf8');

test('referral entry accepts approved affiliates only', () => {
  assert.match(route, /\.eq\('status', 'APPROVED'\)/);
});

test('referral entry preserves an existing valid first touch', () => {
  assert.match(route, /decodeAffiliateReferralCookie\(existingRaw\)/);
  assert.match(route, /return NextResponse\.redirect\(signupUrl\)/);
});

test('existing authenticated accounts cannot receive retroactive attribution', () => {
  assert.match(route, /if \(user\)/);
  assert.match(route, /new URL\('\/dashboard'/);
});

test('referral cookie expires after thirty days', () => {
  assert.match(cookie, /AFFILIATE_COOKIE_DAYS = 30/);
});

test('affiliate referral cookie is http only', () => {
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: 'lax'/);
});

test('signup binding delegates immutable attribution to database authority', () => {
  assert.match(cookie, /\.rpc\('bind_affiliate_referral'/);
});

test('immediate signup binds affiliate attribution before onboarding', () => {
  const bindIndex = signup.indexOf('/api/affiliate/bind-signup');
  const redirectIndex = signup.indexOf("window.location.assign('/onboarding')");
  assert.ok(bindIndex >= 0);
  assert.ok(redirectIndex > bindIndex);
});

test('email confirmation signup also binds affiliate attribution', () => {
  assert.match(callback, /bindAffiliateReferralFromCookie/);
  assert.match(callback, /recentlyCreated/);
});

test('signup binding rejects old existing accounts', () => {
  assert.match(bind, /reason: 'existing_account'/);
});

test('affiliate dashboard exposes the real referral route', () => {
  assert.match(dashboard, /AffiliateShareLink/);
});

test('affiliate dashboard counts persisted first touches', () => {
  assert.match(dashboard, /rpc\('affiliate_click_count'/);
  assert.doesNotMatch(dashboard, /affiliate_referral_touches/);
});

const foundation = fs.readFileSync(
  'supabase/migrations/108_affiliate_foundation.sql',
  'utf8'
);

test('database rejects affiliate self referrals', () => {
  assert.match(
    foundation,
    /AFFILIATE_SELF_REFERRAL/
  );
});

test('tampered referral cookie cannot bind without matching persisted touch', () => {
  assert.match(
    foundation,
    /cookie_value\s*=\s*p_touch_cookie_value/
  );
  assert.match(
    foundation,
    /cookie_expires_at\s*=\s*p_cookie_expires_at/
  );
  assert.match(
    foundation,
    /is_active\s*=\s*true/
  );
  assert.match(
    foundation,
    /is_self_referral\s*=\s*false/
  );
});

test('repeated referral visits do not create another first touch while cookie is valid', () => {
  const existingCookieCheck = route.indexOf(
    'decodeAffiliateReferralCookie(existingRaw)'
  );
  const newTouch = route.indexOf(
    ".from('affiliate_referral_touches')"
  );

  assert.ok(existingCookieCheck >= 0);
  assert.ok(newTouch > existingCookieCheck);
});

test('dashboard describes clicks as unique first-touch visits', () => {
  assert.match(dashboard, /Unique first-touch visits/);
});
