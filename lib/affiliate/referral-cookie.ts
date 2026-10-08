import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

export const AFFILIATE_COOKIE = 'tp_affiliate_ref';
export const AFFILIATE_COOKIE_DAYS = 30;

export type AffiliateReferralCookie = {
  code: string;
  token: string;
  expiresAt: string;
};

export function encodeAffiliateReferralCookie(
  value: AffiliateReferralCookie
) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeAffiliateReferralCookie(
  raw: string | undefined | null
): AffiliateReferralCookie | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8')
    ) as Partial<AffiliateReferralCookie>;

    if (
      typeof parsed.code !== 'string' ||
      !parsed.code.trim() ||
      typeof parsed.token !== 'string' ||
      !parsed.token.trim() ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }

    const expiresAt = new Date(parsed.expiresAt);

    if (!Number.isFinite(expiresAt.getTime())) return null;
    if (expiresAt.getTime() <= Date.now()) return null;

    return {
      code: parsed.code.trim().toUpperCase(),
      token: parsed.token,
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    return null;
  }
}

export async function bindAffiliateReferralFromCookie(
  userId: string,
  rawCookie: string | undefined | null
) {
  const referral = decodeAffiliateReferralCookie(rawCookie);
  if (!referral) return { bound: false as const, reason: 'missing_or_invalid' };

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('bind_affiliate_referral', {
    p_referral_code: referral.code,
    p_referred_user_id: userId,
    p_touch_cookie_value: referral.token,
    p_cookie_expires_at: referral.expiresAt,
  });

  if (error) {
    console.warn('[AFFILIATE_BIND_SKIPPED]', {
      userId,
      code: referral.code,
      message: error.message,
    });

    return { bound: false as const, reason: 'rejected' };
  }

  return {
    bound: Boolean(data),
    reason: data ? 'bound' : 'not_bound',
  } as const;
}
