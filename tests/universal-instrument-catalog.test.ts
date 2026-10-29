import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canUseInstrument,
  catalogInstrumentFromRow,
  sessionOptionsForMarketTypes,
} from '../lib/instrument-catalog.ts';
import { buildPayloadInstruments, deriveStopLimitsForInstruments } from '../lib/strategy-builder-draft.ts';
import { twelveDataReferenceRows } from '../lib/twelve-data-reference.ts';

const verifiedAt = '2026-09-27T00:00:00.000Z';

test('Twelve Data reference rows preserve supported asset classes and provider symbols', () => {
  const stocks = twelveDataReferenceRows('STOCKS', { data: [
    { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', currency: 'USD', type: 'Common Stock' },
    { symbol: 'SHOP', name: 'Shopify', exchange: 'TSX', country: 'Canada', currency: 'CAD' },
  ] }, verifiedAt, { externalDisplayLicensed: true });
  const etfs = twelveDataReferenceRows('ETFS', { data: [{ symbol: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'NYSE ARCA', currency: 'USD' }] }, verifiedAt, { externalDisplayLicensed: true });
  const crypto = twelveDataReferenceRows('CRYPTO', { data: [{ symbol: 'BTC/USD', currency_base: 'Bitcoin', currency_quote: 'US Dollar' }] }, verifiedAt, { externalDisplayLicensed: true });
  const forex = twelveDataReferenceRows('FOREX', { data: [{ symbol: 'GBP/JPY', currency_base: 'British Pound', currency_quote: 'Japanese Yen' }] }, verifiedAt, { externalDisplayLicensed: true });

  assert.deepEqual(stocks.map((item) => item.symbol), ['AAPL']);
  assert.equal(stocks[0]?.market_type, 'STOCKS');
  assert.deepEqual(stocks[0]?.metadata.capabilities, ['QUOTE', 'HISTORICAL', 'LIVE_ANALYSIS']);
  assert.equal(etfs[0]?.market_type, 'ETFS');
  assert.equal(crypto[0]?.symbol, 'BTCUSD');
  assert.equal(crypto[0]?.provider_symbol, 'BTC/USD');
  assert.equal(forex[0]?.symbol, 'GBPJPY');
  assert.equal(forex[0]?.provider_symbol, 'GBP/JPY');
  assert.deepEqual(forex[0]?.metadata.capabilities, ['QUOTE', 'HISTORICAL', 'BACKTEST', 'LIVE_ANALYSIS']);
});

test('commodities are catalogued but remain plan-gated', () => {
  const [commodity] = twelveDataReferenceRows('COMMODITIES', { data: [{ symbol: 'WTI/USD', name: 'WTI Crude Oil' }] }, verifiedAt);
  assert.equal(commodity?.market_type, 'COMMODITIES');
  assert.equal(commodity?.metadata.availability, 'PLAN_REQUIRED');
  assert.deepEqual(commodity?.metadata.capabilities, []);
});

test('customer-facing instruments stay gated without an external-display entitlement', () => {
  const [stock] = twelveDataReferenceRows('STOCKS', { data: [
    { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', currency: 'USD' },
  ] }, verifiedAt);
  assert.equal(stock?.metadata.availability, 'PLAN_REQUIRED');
  assert.deepEqual(stock?.metadata.capabilities, []);
});

test('verified markets become usable only in explicitly enabled internal test mode', () => {
  const [stock] = twelveDataReferenceRows('STOCKS', { data: [
    { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', currency: 'USD', type: 'Common Stock' },
  ] }, verifiedAt, { internalTestingEnabled: true });
  const instrument = stock ? catalogInstrumentFromRow(stock) : null;
  assert.ok(instrument);
  assert.equal(instrument.availability, 'INTERNAL_TEST_ONLY');
  assert.deepEqual(instrument.capabilities, ['QUOTE', 'HISTORICAL', 'LIVE_ANALYSIS']);
  assert.equal(canUseInstrument(instrument, 'LIVE_ANALYSIS'), false);
  assert.equal(canUseInstrument(instrument, 'LIVE_ANALYSIS', { internalTestAuthorized: false }), false);
  assert.equal(canUseInstrument(instrument, 'LIVE_ANALYSIS', { internalTestAuthorized: true }), true);
  assert.equal(canUseInstrument(instrument, 'BACKTEST', { internalTestAuthorized: true }), false);
});

test('catalog capability gate requires both availability and requested capability', () => {
  const instrument = catalogInstrumentFromRow({
    symbol: 'AAPL', display_name: 'Apple Inc', market_type: 'STOCKS', category: 'COMMON_STOCK',
    provider_symbol: 'AAPL', is_active: true,
    metadata: { availability: 'AVAILABLE', capabilities: ['QUOTE', 'HISTORICAL', 'BACKTEST', 'LIVE_ANALYSIS'] },
  });
  assert.ok(instrument);
  assert.equal(canUseInstrument(instrument, 'BACKTEST'), true);
  assert.equal(canUseInstrument({ ...instrument, availability: 'PLAN_REQUIRED' }, 'BACKTEST'), false);
});

test('external-display entitlement promotes synchronized instruments to external availability', () => {
  const [stock] = twelveDataReferenceRows('STOCKS', { data: [
    { symbol: 'AAPL', name: 'Apple Inc', exchange: 'NASDAQ', country: 'United States', currency: 'USD', type: 'Common Stock' },
  ] }, verifiedAt, { externalDisplayLicensed: true, internalTestingEnabled: true });
  assert.equal(stock?.metadata.availability, 'AVAILABLE');
  assert.equal(stock?.metadata.licenseTier, 'EXTERNAL_DISPLAY_LICENSED');
});

test('strategy payload and risk defaults are asset-class aware', () => {
  const catalog = [
    catalogInstrumentFromRow({ symbol: 'AAPL', display_name: 'Apple', market_type: 'STOCKS', category: 'COMMON_STOCK', provider_symbol: 'AAPL' }),
    catalogInstrumentFromRow({ symbol: 'SPY', display_name: 'SPY', market_type: 'ETFS', category: 'ETF', provider_symbol: 'SPY' }),
    catalogInstrumentFromRow({ symbol: 'BTCUSD', display_name: 'BTC / USD', market_type: 'CRYPTO', category: 'DIGITAL_ASSET', provider_symbol: 'BTC/USD' }),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  assert.deepEqual(buildPayloadInstruments(['AAPL', 'SPY', 'BTCUSD'], catalog).map(({ symbol, market_type, provider_symbol }) => ({ symbol, market_type, provider_symbol })), [
    { symbol: 'AAPL', market_type: 'STOCKS', provider_symbol: 'AAPL' },
    { symbol: 'SPY', market_type: 'ETFS', provider_symbol: 'SPY' },
    { symbol: 'BTCUSD', market_type: 'CRYPTO', provider_symbol: 'BTC/USD' },
  ]);
  assert.deepEqual(deriveStopLimitsForInstruments(['AAPL', 'SPY', 'BTCUSD'], [], catalog).map((item) => item.method), ['PERCENT', 'PERCENT', 'PERCENT']);
});

test('session choices follow selected asset classes instead of assuming Forex', () => {
  assert.deepEqual(sessionOptionsForMarketTypes(['CRYPTO']), ['CRYPTO_24_7']);
  assert.deepEqual(sessionOptionsForMarketTypes(['STOCKS']), ['US_STOCK_PREMARKET', 'US_REGULAR', 'US_POWER_HOUR', 'AFTER_HOURS']);
  assert.deepEqual(sessionOptionsForMarketTypes(['FOREX']), ['SYDNEY', 'TOKYO', 'LONDON', 'NEW_YORK']);
  assert.deepEqual(sessionOptionsForMarketTypes(['ETFS', 'CRYPTO']), ['US_STOCK_PREMARKET', 'US_REGULAR', 'US_POWER_HOUR', 'AFTER_HOURS', 'CRYPTO_24_7']);
});
