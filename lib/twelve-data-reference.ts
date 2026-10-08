import { canonicalSymbol, type InstrumentAvailability, type InstrumentCapability, type MarketType } from './instrument-catalog.ts';

export type TwelveDataReferenceMarket = 'FOREX' | 'STOCKS' | 'ETFS' | 'CRYPTO' | 'COMMODITIES';

export type InstrumentCatalogUpsert = {
  symbol: string;
  display_name: string;
  market_type: MarketType;
  category: string;
  exchange: string | null;
  country: string | null;
  sector: string | null;
  base_currency: string | null;
  quote_currency: string | null;
  provider_symbol: string;
  is_active: boolean;
  last_verified_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE ARCA', 'CBOE', 'OTC', 'OTCQB', 'OTCQX']);
const METAL_CODES = new Set(['XAU', 'XAG', 'XPT', 'XPD']);
const EXECUTION_CAPABILITIES: InstrumentCapability[] = ['QUOTE', 'HISTORICAL', 'BACKTEST', 'LIVE_ANALYSIS'];
const MARKET_DATA_CAPABILITIES: InstrumentCapability[] = ['QUOTE', 'HISTORICAL', 'LIVE_ANALYSIS'];

function values(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  const candidate = record.data ?? record.values ?? record.result;
  return Array.isArray(candidate) ? candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === 'string' ? row[key].trim() : '';
}

function pair(providerSymbol: string): { base: string | null; quote: string | null } {
  const parts = providerSymbol.toUpperCase().split('/').map((item) => item.trim()).filter(Boolean);
  return parts.length === 2 ? { base: parts[0]!, quote: parts[1]! } : { base: null, quote: null };
}

function availabilityFor(
  market: TwelveDataReferenceMarket,
  externalDisplayLicensed: boolean,
  internalTestingEnabled: boolean,
): InstrumentAvailability {
  // Reference metadata can be visible even when the subscribed data plan cannot
  // deliver prices. Additional commodities remain gated until that entitlement
  // is explicitly represented instead of treating catalog visibility as access.
  if (market === 'COMMODITIES') return 'PLAN_REQUIRED';
  if (externalDisplayLicensed) return 'AVAILABLE';
  if (internalTestingEnabled) return 'INTERNAL_TEST_ONLY';
  return 'PLAN_REQUIRED';
}

function capabilitiesFor(marketType: MarketType, availability: InstrumentAvailability): InstrumentCapability[] {
  if (availability !== 'AVAILABLE' && availability !== 'INTERNAL_TEST_ONLY') return [];
  if (marketType === 'FOREX' || marketType === 'METALS') return EXECUTION_CAPABILITIES;
  // Stocks/ETFs need adjusted-price and corporate-action verification, and
  // crypto needs a frozen venue/source contract, before historical runs are reproducible.
  return MARKET_DATA_CAPABILITIES;
}

function row(input: {
  providerSymbol: string;
  name: string;
  marketType: MarketType;
  category: string;
  exchange?: string;
  country?: string;
  currency?: string;
  base?: string | null;
  quote?: string | null;
  availability: InstrumentAvailability;
  timezone?: string;
  sourceMarket: TwelveDataReferenceMarket;
  rawType?: string;
  availableExchanges?: unknown;
  verifiedAt: string;
}): InstrumentCatalogUpsert | null {
  const symbol = canonicalSymbol(input.providerSymbol);
  if (!symbol || !input.providerSymbol.trim()) return null;
  const capabilities = capabilitiesFor(input.marketType, input.availability);
  return {
    symbol,
    display_name: input.name || symbol,
    market_type: input.marketType,
    category: input.category || 'OTHER',
    exchange: input.exchange || null,
    country: input.country || null,
    sector: null,
    base_currency: input.base ?? null,
    quote_currency: input.quote ?? input.currency ?? null,
    provider_symbol: input.providerSymbol.toUpperCase(),
    is_active: true,
    last_verified_at: input.verifiedAt,
    updated_at: input.verifiedAt,
    metadata: {
      provider: 'TWELVE_DATA',
      sourceMarket: input.sourceMarket,
      availability: input.availability,
      capabilities,
      licenseTier: input.availability === 'AVAILABLE'
        ? 'EXTERNAL_DISPLAY_LICENSED'
        : input.availability === 'INTERNAL_TEST_ONLY'
          ? 'BASIC_INTERNAL_NON_DISPLAY'
          : 'EXTERNAL_DISPLAY_ENTITLEMENT_REQUIRED',
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.rawType ? { providerType: input.rawType } : {}),
      ...(Array.isArray(input.availableExchanges) ? { availableExchanges: input.availableExchanges } : {}),
    },
  };
}

export function twelveDataReferenceRows(
  market: TwelveDataReferenceMarket,
  payload: unknown,
  verifiedAt = new Date().toISOString(),
  options: { externalDisplayLicensed?: boolean; internalTestingEnabled?: boolean } = {},
): InstrumentCatalogUpsert[] {
  const mapped = values(payload).flatMap((item) => {
    const providerSymbol = text(item, 'symbol');
    if (!providerSymbol) return [];
    const exchange = text(item, 'exchange');
    const country = text(item, 'country');
    const currency = text(item, 'currency');
    const parsedPair = pair(providerSymbol);
    const availability = availabilityFor(
      market,
      options.externalDisplayLicensed === true,
      options.internalTestingEnabled === true,
    );

    if (market === 'STOCKS') {
      const isUnitedStates = /united states|usa|us/i.test(country) || (!country && US_EXCHANGES.has(exchange.toUpperCase()));
      const providerType = text(item, 'type');
      if (!isUnitedStates || /etf|fund/i.test(providerType)) return [];
      const result = row({ providerSymbol, name:text(item,'name'), marketType:'STOCKS', category:providerType || 'COMMON_STOCK', exchange, country:country || 'United States', currency, availability, timezone:'America/New_York', sourceMarket:market, rawType:providerType, verifiedAt });
      return result ? [result] : [];
    }
    if (market === 'ETFS') {
      const result = row({ providerSymbol, name:text(item,'name'), marketType:'ETFS', category:'ETF', exchange, country:country || (US_EXCHANGES.has(exchange.toUpperCase()) ? 'United States' : ''), currency, availability, timezone:US_EXCHANGES.has(exchange.toUpperCase()) ? 'America/New_York' : undefined, sourceMarket:market, verifiedAt });
      return result ? [result] : [];
    }
    if (market === 'FOREX') {
      const result = row({ providerSymbol, name:`${text(item,'currency_base') || parsedPair.base} / ${text(item,'currency_quote') || parsedPair.quote}`, marketType:'FOREX', category:text(item,'currency_group').toUpperCase() || 'OTHER', base:parsedPair.base, quote:parsedPair.quote, availability, timezone:'UTC', sourceMarket:market, verifiedAt });
      return result ? [result] : [];
    }
    if (market === 'CRYPTO') {
      const result = row({ providerSymbol, name:`${text(item,'currency_base') || parsedPair.base} / ${text(item,'currency_quote') || parsedPair.quote}`, marketType:'CRYPTO', category:'DIGITAL_ASSET', base:parsedPair.base, quote:parsedPair.quote, availability, timezone:'UTC', sourceMarket:market, availableExchanges:item.available_exchanges, verifiedAt });
      return result ? [result] : [];
    }
    const commodityType: MarketType = parsedPair.base && METAL_CODES.has(parsedPair.base) ? 'METALS' : 'COMMODITIES';
    const result = row({ providerSymbol, name:text(item,'name') || providerSymbol, marketType:commodityType, category:commodityType === 'METALS' ? 'METAL' : text(item,'category').toUpperCase() || 'COMMODITY', exchange, country, currency, base:parsedPair.base, quote:parsedPair.quote, availability, timezone:'UTC', sourceMarket:market, verifiedAt });
    return result ? [result] : [];
  });

  const unique = new Map<string, InstrumentCatalogUpsert>();
  for (const item of mapped) unique.set(`${item.market_type}:${item.symbol}`, item);
  return [...unique.values()];
}

export const TWELVE_DATA_REFERENCE_ENDPOINTS: Record<TwelveDataReferenceMarket, string> = {
  FOREX: 'forex_pairs',
  STOCKS: 'stocks?country=United States',
  ETFS: 'etf',
  CRYPTO: 'cryptocurrencies',
  COMMODITIES: 'commodities',
};
