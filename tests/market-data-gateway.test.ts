import assert from 'node:assert/strict';
import test from 'node:test';
import type { MarketDataProvider, MarketDataRequest, ProviderSnapshotResponse } from '../lib/market-intelligence/providers/market-data-provider.ts';
import { MarketDataGateway, MarketDataGatewayError } from '../lib/market-intelligence/providers/gateway.ts';
import { ProviderRegistry } from '../lib/market-intelligence/providers/provider-registry.ts';

const requestedAt = '2026-07-21T12:00:00.000Z';
const request: MarketDataRequest = { instrument: 'XAUUSD', timeframe: 'H1', candleCount: 2, includeCurrentPrice: true, includeSpread: false, allowCached: true, maximumDataAge: 7_200_000, requestedAt };
const response: ProviderSnapshotResponse = {
  providerSymbol: 'XAU/USD', receivedAt: requestedAt, warnings: [], currentPrice: 2_402,
  candles: [
    { timestamp: '2026-07-21T10:00:00.000Z', open: 2_400, high: 2_402, low: 2_399, close: 2_401, volume: 100 },
    { timestamp: '2026-07-21T11:00:00.000Z', open: 2_401, high: 2_403, low: 2_400, close: 2_402, volume: null },
  ],
};

class FixtureProvider implements MarketDataProvider {
  readonly id = 'fixture';
  readonly version = '1.0.0';
  readonly displayName = 'Fixture';
  readonly supportsReplay = true;
  readonly supportsHistorical = true;
  readonly supportedMarkets = ['METALS'];
  readonly supportedTimeframes = ['H1'];
  private readonly load: () => Promise<ProviderSnapshotResponse>;
  constructor(load: () => Promise<ProviderSnapshotResponse>) { this.load = load; }
  async health() { return { status: 'HEALTHY' as const, checkedAt: requestedAt }; }
  async fetchSnapshot() { return this.load(); }
}

function gateway(load: () => Promise<ProviderSnapshotResponse> = async () => structuredClone(response), timeoutMs = 100) {
  const registry = new ProviderRegistry().register(new FixtureProvider(load)).freeze();
  return new MarketDataGateway(registry, { timeoutMs, createSnapshotId: () => 'snapshot-1' });
}

test('gateway validates normalized requests before calling a provider', async () => {
  let called = false;
  const instance = gateway(async () => { called = true; return response; });
  await assert.rejects(() => instance.fetchSnapshot('fixture', { ...request, candleCount: 0 }), (error: unknown) => error instanceof MarketDataGatewayError && error.code === 'INVALID_CANDLE_COUNT');
  await assert.rejects(() => instance.fetchSnapshot('fixture', { ...request, requestedAt: 'not-a-date' }), /ISO-8601/);
  await assert.rejects(() => instance.fetchSnapshot('fixture', { ...request, timeframe: 'BAD' }), /unsupported/);
  assert.equal(called, false);
});

test('gateway normalizes candles, timestamps, prices, completeness, and freshness', async () => {
  const snapshot = await gateway().fetchSnapshot('fixture', request);
  assert.equal(snapshot.id, 'snapshot-1');
  assert.equal(snapshot.provider, 'fixture');
  assert.equal(snapshot.providerVersion, '1.0.0');
  assert.equal(snapshot.instrument, 'XAUUSD');
  assert.equal(snapshot.candles[0].openedAt, '2026-07-21T10:00:00.000Z');
  assert.equal(snapshot.candles[1].closedAt, requestedAt);
  assert.equal(snapshot.candles[1].complete, true);
  assert.equal(snapshot.currentPrice, 2_402);
  assert.equal(snapshot.freshness.state, 'FRESH');
  assert.equal(snapshot.freshness.ageMs, 3_600_000);
});

test('gateway marks stale data and incomplete candles explicitly', async () => {
  const stale = await gateway().fetchSnapshot('fixture', { ...request, requestedAt: '2026-07-21T12:30:00.000Z', maximumDataAge: 60_000 });
  assert.equal(stale.freshness.state, 'STALE');
  assert.match(stale.validationWarnings.join(' '), /stale/);
  const incompleteResponse = structuredClone(response);
  incompleteResponse.candles.push({ timestamp: '2026-07-21T12:00:00.000Z', open: 2_402, high: 2_404, low: 2_401, close: 2_403, volume: 90 });
  const incomplete = await gateway(async () => incompleteResponse).fetchSnapshot('fixture', request);
  assert.equal(incomplete.candles.at(-1)?.complete, false);
  assert.match(incomplete.validationWarnings.join(' '), /incomplete candle/);
});

test('gateway rejects invalid ordering and missing candles', async () => {
  const reversed = structuredClone(response);
  reversed.candles.reverse();
  await assert.rejects(() => gateway(async () => reversed).fetchSnapshot('fixture', request), (error: unknown) => error instanceof MarketDataGatewayError && error.code === 'INVALID_CANDLE_ORDER');
  await assert.rejects(() => gateway(async () => ({ ...response, candles: [] })).fetchSnapshot('fixture', request), (error: unknown) => error instanceof MarketDataGatewayError && error.code === 'MISSING_CANDLES');
});

test('gateway converts provider failures and timeouts to stable errors', async () => {
  await assert.rejects(() => gateway(async () => { throw new Error('upstream unavailable'); }).fetchSnapshot('fixture', request), (error: unknown) => error instanceof MarketDataGatewayError && error.code === 'PROVIDER_FAILURE');
  await assert.rejects(() => gateway(() => new Promise(() => {}), 5).fetchSnapshot('fixture', request), (error: unknown) => error instanceof MarketDataGatewayError && error.code === 'PROVIDER_TIMEOUT');
});

test('gateway returns a deeply immutable snapshot', async () => {
  const snapshot = await gateway().fetchSnapshot('fixture', request);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.candles), true);
  assert.equal(Object.isFrozen(snapshot.candles[0]), true);
  assert.equal(Object.isFrozen(snapshot.freshness), true);
  assert.throws(() => { (snapshot.candles as unknown as Array<unknown>).push({}); }, /object is not extensible|read only/i);
});
