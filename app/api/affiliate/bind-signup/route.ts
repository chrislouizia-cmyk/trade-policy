import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import {
  AFFILIATE_COOKIE,
  bindAffiliateReferralFromCookie,
} from '@/lib/affiliate/referral-cookie';

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const createdAt = new Date(user.created_at).getTime();
  const recentlyCreated =
    Number.isFinite(createdAt) &&
    Date.now() - createdAt < 10 * 60 * 1000;

  if (!recentlyCreated) {
    return NextResponse.json({
      ok: true,
      bound: false,
      reason: 'existing_account',
    });
  }

  const cookieStore = await cookies();
  const raw = cookieStore.get(AFFILIATE_COOKIE)?.value;

  const result = await bindAffiliateReferralFromCookie(user.id, raw);

  const response = NextResponse.json({
    ok: true,
    bound: result.bound,
  });

  response.cookies.delete(AFFILIATE_COOKIE);

  return response;
}
