import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  AFFILIATE_COOKIE,
  AFFILIATE_COOKIE_DAYS,
  decodeAffiliateReferralCookie,
  encodeAffiliateReferralCookie,
} from '@/lib/affiliate/referral-cookie';

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const code = rawCode.trim().toUpperCase();
  const requestUrl = new URL(request.url);

  const signupUrl = new URL('/client/login', requestUrl.origin);
  signupUrl.searchParams.set('mode', 'signup');

  if (!code) return NextResponse.redirect(signupUrl);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Existing accounts cannot be retroactively attributed.
  if (user) {
    return NextResponse.redirect(new URL('/dashboard', requestUrl.origin));
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  const existingRaw = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AFFILIATE_COOKIE}=`))
    ?.slice(AFFILIATE_COOKIE.length + 1);

  // Immutable first-touch: a valid existing referral wins.
  if (decodeAffiliateReferralCookie(existingRaw)) {
    return NextResponse.redirect(signupUrl);
  }

  const admin = createAdminClient();

  const { data: affiliate, error } = await admin
    .from('affiliate_profiles')
    .select('id,user_id,referral_code,status')
    .eq('referral_code', code)
    .eq('status', 'APPROVED')
    .maybeSingle();

  if (error || !affiliate) {
    return NextResponse.redirect(signupUrl);
  }

  const visitorId = randomUUID();
  const token = randomUUID();
  const expiresAt = new Date(
    Date.now() + AFFILIATE_COOKIE_DAYS * 24 * 60 * 60 * 1000
  );

  const { error: touchError } = await admin
    .from('affiliate_referral_touches')
    .insert({
      affiliate_id: affiliate.id,
      visitor_id: visitorId,
      referral_code: affiliate.referral_code,
      cookie_value: token,
      cookie_expires_at: expiresAt.toISOString(),
      is_self_referral: false,
      is_active: true,
    });

  if (touchError) {
    console.error('[AFFILIATE_TOUCH_FAILED]', {
      affiliateId: affiliate.id,
      message: touchError.message,
    });

    return NextResponse.redirect(signupUrl);
  }

  const response = NextResponse.redirect(signupUrl);

  response.cookies.set(
    AFFILIATE_COOKIE,
    encodeAffiliateReferralCookie({
      code: affiliate.referral_code,
      token,
      expiresAt: expiresAt.toISOString(),
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    }
  );

  return response;
}
