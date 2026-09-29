import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  TWELVE_DATA_REFERENCE_ENDPOINTS,
  twelveDataReferenceRows,
  type TwelveDataReferenceMarket,
} from '@/lib/twelve-data-reference';
import { isInternalMarketTestingEnabled } from '@/lib/server/instrument-access';

const REQUEST_TIMEOUT_MS = 20_000;
const UPSERT_BATCH_SIZE = 500;

export async function syncTwelveDataInstrumentMarket(market: TwelveDataReferenceMarket) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) throw new Error('TWELVE_DATA_API_KEY is not configured.');

  const endpoint = TWELVE_DATA_REFERENCE_ENDPOINTS[market];
  const url = new URL(`https://api.twelvedata.com/${endpoint}`);
  url.searchParams.set('format', 'JSON');
  url.searchParams.set('apikey', apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || (payload && typeof payload === 'object' && 'status' in payload && payload.status === 'error')) {
    const message = payload && typeof payload === 'object' && 'message' in payload ? String(payload.message) : `HTTP ${response.status}`;
    throw new Error(`Twelve Data ${market} reference sync failed: ${message}`);
  }

  const verifiedAt = new Date().toISOString();
  const rows = twelveDataReferenceRows(market, payload, verifiedAt, {
    externalDisplayLicensed: process.env.TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED === 'true',
    internalTestingEnabled: isInternalMarketTestingEnabled(),
  });
  if (!rows.length) throw new Error(`Twelve Data ${market} reference sync returned no usable instruments.`);

  const admin = createAdminClient();
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE);
    const { error } = await admin.from('instrument_catalog').upsert(batch, { onConflict: 'symbol,market_type' });
    if (error) throw error;
  }

  return {
    market,
    endpoint: endpoint.split('?')[0],
    synchronized: rows.length,
    available: rows.filter((item) => item.metadata.availability === 'AVAILABLE').length,
    internalTestOnly: rows.filter((item) => item.metadata.availability === 'INTERNAL_TEST_ONLY').length,
    planRequired: rows.filter((item) => item.metadata.availability === 'PLAN_REQUIRED').length,
    verifiedAt,
  };
}
