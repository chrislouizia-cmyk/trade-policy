import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderRegistry } from '../lib/market-intelligence/providers/bootstrap.ts';
import type { MarketDataProvider } from '../lib/market-intelligence/providers/market-data-provider.ts';
import { ProviderRegistry } from '../lib/market-intelligence/providers/provider-registry.ts';
import { TwelveDataProvider } from '../lib/market-intelligence/providers/twelve-data-provider.ts';

const fixture = (id: string): MarketDataProvider => ({
  id, version: '1.0.0', displayName: id, supportsReplay: false, supportsHistorical: true,
  supportedMarkets: ['FOREX'], supportedTimeframes: ['H1'],
  async health() { return { status: 'HEALTHY', checkedAt: '2026-07-21T12:00:00.000Z' }; },
  async fetchSnapshot() { return { providerSymbol: 'XAU/USD', candles: [], receivedAt: '2026-07-21T12:00:00.000Z', warnings: [] }; },
});

test('provider registry registers, gets, checks, and lists providers', () => {
  const provider = fixture('fixture');
  const registry = new ProviderRegistry().register(provider);
  assert.equal(registry.exists('fixture'), true);
  assert.equal(registry.get('fixture'), provider);
  assert.deepEqual(registry.list(), [provider]);
  assert.equal(Object.isFrozen(registry.list()), true);
});

test('provider registry prevents duplicates and mutation after freeze', () => {
  const registry = new ProviderRegistry().register(fixture('fixture'));
  assert.throws(() => registry.register(fixture('fixture')), /already registered/);
  registry.freeze();
  assert.equal(registry.frozen, true);
  assert.throws(() => registry.register(fixture('other')), /frozen/);
});

test('bootstrap registers only the Twelve Data wrapper and freezes', () => {
  const registry = createProviderRegistry();
  assert.equal(registry.frozen, true);
  assert.equal(registry.list().length, 1);
  assert.ok(registry.get('twelve-data') instanceof TwelveDataProvider);
});

test('Twelve Data wrapper exposes provider capabilities without performing analysis', () => {
  const provider = new TwelveDataProvider();
  assert.equal(provider.displayName, 'Twelve Data');
  assert.equal(provider.supportsReplay, false);
  assert.equal(provider.supportsHistorical, true);
  assert.ok(provider.supportedTimeframes.includes('H1'));
  assert.ok(provider.supportedMarkets.includes('FOREX'));
});
