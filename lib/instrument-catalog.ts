import type { StopMethod } from '../types/trade.ts';

export const MARKET_TYPES = [
  'FOREX',
  'METALS',
  'STOCKS',
  'ETFS',
  'CRYPTO',
  'INDEX',
  'FUTURES',
  'COMMODITIES',
] as const;

export type MarketType = (typeof MARKET_TYPES)[number];
export type InstrumentAvailability = 'AVAILABLE' | 'INTERNAL_TEST_ONLY' | 'PLAN_REQUIRED' | 'REFERENCE_ONLY' | 'UNVERIFIED';
export type InstrumentCapability = 'QUOTE' | 'HISTORICAL' | 'BACKTEST' | 'LIVE_ANALYSIS';
export type InstrumentAccessContext = { internalTestAuthorized?: boolean };

export type CatalogInstrument = {
  symbol: string;
  displayName: string;
  marketType: MarketType;
  category: string;
  providerSymbol: string;
  exchange?: string | null;
  country?: string | null;
  currency?: string | null;
  baseCurrency?: string | null;
  quoteCurrency?: string | null;
  timezone?: string | null;
  availability: InstrumentAvailability;
  capabilities: InstrumentCapability[];
};

export type InstrumentCatalogRow = {
  symbol: string;
  display_name: string;
  market_type: string;
  category: string;
  provider_symbol: string | null;
  exchange?: string | null;
  country?: string | null;
  base_currency?: string | null;
  quote_currency?: string | null;
  is_active?: boolean | null;
  metadata?: Record<string, unknown> | null;
};

export const SESSION_LABELS: Readonly<Record<string, string>> = {
  SYDNEY: 'Sydney',
  TOKYO: 'Tokyo',
  ASIA: 'Asia',
  LONDON: 'London',
  LONDON_OPEN: 'London Open',
  NEW_YORK: 'New York',
  NEW_YORK_AM: 'New York AM',
  US_FUTURES_PREMARKET: 'US Futures Premarket',
  US_STOCK_PREMARKET: 'US Stock Premarket',
  US_REGULAR: 'US Regular Session',
  US_POWER_HOUR: 'US Power Hour',
  AFTER_HOURS: 'After Hours',
  CRYPTO_24_7: 'Crypto 24/7',
};

export function isMarketType(value: unknown): value is MarketType {
  return typeof value === 'string' && (MARKET_TYPES as readonly string[]).includes(value);
}

export function canonicalSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[\s/_-]+/g, '');
}

export function catalogInstrumentFromRow(row: InstrumentCatalogRow): CatalogInstrument | null {
  if (!isMarketType(row.market_type)) return null;
  const symbol = canonicalSymbol(row.symbol);
  const providerSymbol = String(row.provider_symbol ?? '').trim();
  if (!symbol || !providerSymbol) return null;
  const metadata = row.metadata ?? {};
  const availability = String(metadata.availability ?? (row.is_active === false ? 'UNVERIFIED' : 'AVAILABLE'));
  const rawCapabilities = Array.isArray(metadata.capabilities) ? metadata.capabilities : ['QUOTE', 'HISTORICAL', 'BACKTEST', 'LIVE_ANALYSIS'];
  return {
    symbol,
    displayName: row.display_name,
    marketType: row.market_type,
    category: row.category,
    providerSymbol,
    exchange: row.exchange ?? null,
    country: row.country ?? null,
    currency: typeof metadata.currency === 'string' ? metadata.currency : null,
    baseCurrency: row.base_currency ?? null,
    quoteCurrency: row.quote_currency ?? null,
    timezone: typeof metadata.timezone === 'string' ? metadata.timezone : null,
    availability: ['AVAILABLE', 'INTERNAL_TEST_ONLY', 'PLAN_REQUIRED', 'REFERENCE_ONLY', 'UNVERIFIED'].includes(availability)
      ? availability as InstrumentAvailability
      : 'UNVERIFIED',
    capabilities: rawCapabilities.filter((item): item is InstrumentCapability =>
      typeof item === 'string' && ['QUOTE', 'HISTORICAL', 'BACKTEST', 'LIVE_ANALYSIS'].includes(item)),
  };
}

export function defaultStopMethod(marketType: MarketType): StopMethod {
  if (marketType === 'FOREX') return 'PIPS';
  if (marketType === 'METALS' || marketType === 'COMMODITIES' || marketType === 'FUTURES' || marketType === 'INDEX') return 'TICKS';
  return 'PERCENT';
}

export function defaultSessions(marketType: MarketType): string[] {
  if (marketType === 'CRYPTO') return ['CRYPTO_24_7'];
  if (marketType === 'STOCKS' || marketType === 'ETFS') return ['US_REGULAR'];
  if (marketType === 'FUTURES' || marketType === 'INDEX') return ['US_FUTURES_PREMARKET', 'US_REGULAR'];
  return ['LONDON', 'NEW_YORK'];
}

export function sessionOptionsForMarketTypes(marketTypes: readonly MarketType[]): string[] {
  const result = new Set<string>();
  for (const marketType of marketTypes) {
    if (marketType === 'CRYPTO') {
      result.add('CRYPTO_24_7');
      continue;
    }
    if (marketType === 'STOCKS' || marketType === 'ETFS') {
      result.add('US_STOCK_PREMARKET');
      result.add('US_REGULAR');
      result.add('US_POWER_HOUR');
      result.add('AFTER_HOURS');
      continue;
    }
    if (marketType === 'FUTURES' || marketType === 'INDEX') {
      result.add('US_FUTURES_PREMARKET');
      result.add('US_REGULAR');
      continue;
    }
    result.add('SYDNEY');
    result.add('TOKYO');
    result.add('LONDON');
    result.add('NEW_YORK');
  }
  return [...result];
}

export function canUseInstrument(
  instrument: CatalogInstrument,
  capability: InstrumentCapability,
  access: InstrumentAccessContext = {},
): boolean {
  const availabilityGranted = instrument.availability === 'AVAILABLE'
    || (instrument.availability === 'INTERNAL_TEST_ONLY' && access.internalTestAuthorized === true);
  return availabilityGranted && instrument.capabilities.includes(capability);
}

export function canSelectVisibleInstrument(instrument: CatalogInstrument): boolean {
  return instrument.availability === 'AVAILABLE' || instrument.availability === 'INTERNAL_TEST_ONLY';
}
