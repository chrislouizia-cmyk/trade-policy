import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InstrumentAccessContext } from '@/lib/instrument-catalog';

export function internalInstrumentAccessFromRole(
  staffRole: unknown,
  internalTestingEnabled = process.env.TWELVE_DATA_INTERNAL_TEST_ENABLED === 'true',
): InstrumentAccessContext {
  return {
    internalTestAuthorized: internalTestingEnabled
      && typeof staffRole === 'string'
      && staffRole.trim().length > 0,
  };
}

export async function resolveInstrumentAccessContext(client: SupabaseClient): Promise<InstrumentAccessContext> {
  if (process.env.TWELVE_DATA_INTERNAL_TEST_ENABLED !== 'true') {
    return { internalTestAuthorized: false };
  }
  const { data, error } = await client.rpc('current_staff_role');
  if (error) {
    console.error('[INTERNAL_MARKET_ACCESS_CHECK_FAILED]', { message: error.message ?? 'Unknown staff lookup error' });
    return { internalTestAuthorized: false };
  }
  return internalInstrumentAccessFromRole(data, true);
}
