import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InstrumentAccessContext } from '@/lib/instrument-catalog';

export function internalInstrumentAccessFromAuthorization(
  authorized: unknown,
  internalTestingEnabled = process.env.TWELVE_DATA_INTERNAL_TEST_ENABLED === 'true',
): InstrumentAccessContext {
  return {
    internalTestAuthorized: internalTestingEnabled && authorized === true,
  };
}

export async function resolveInstrumentAccessContext(client: SupabaseClient): Promise<InstrumentAccessContext> {
  if (process.env.TWELVE_DATA_INTERNAL_TEST_ENABLED !== 'true') {
    return { internalTestAuthorized: false };
  }
  const { data, error } = await client.rpc('has_internal_market_test_access');
  if (error) {
    console.error('[INTERNAL_MARKET_ACCESS_CHECK_FAILED]', { message: error.message ?? 'Unknown entitlement lookup error' });
    return { internalTestAuthorized: false };
  }
  return internalInstrumentAccessFromAuthorization(data, true);
}
