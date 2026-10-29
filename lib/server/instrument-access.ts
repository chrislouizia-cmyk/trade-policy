import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InstrumentAccessContext } from '@/lib/instrument-catalog';

/**
 * Internal market testing is entitlement-first. The environment variable is
 * an emergency kill switch: setting it to `false` disables provider access,
 * while an absent variable does not silently lock out approved testers.
 */
export function isInternalMarketTestingEnabled(
  disabledValue = process.env.TWELVE_DATA_INTERNAL_TEST_DISABLED,
): boolean {
  return disabledValue !== 'true';
}

export function internalInstrumentAccessFromAuthorization(
  authorized: unknown,
  internalTestingEnabled = isInternalMarketTestingEnabled(),
): InstrumentAccessContext {
  return {
    internalTestAuthorized: internalTestingEnabled && authorized === true,
  };
}

export async function resolveInstrumentAccessContext(client: SupabaseClient): Promise<InstrumentAccessContext> {
  if (!isInternalMarketTestingEnabled()) {
    return { internalTestAuthorized: false };
  }
  const { data, error } = await client.rpc('has_internal_market_test_access');
  if (error) {
    console.error('[INTERNAL_MARKET_ACCESS_CHECK_FAILED]', { message: error.message ?? 'Unknown entitlement lookup error' });
    return { internalTestAuthorized: false };
  }
  return internalInstrumentAccessFromAuthorization(data, true);
}
