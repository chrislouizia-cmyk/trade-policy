import assert from 'node:assert/strict';
import test from 'node:test';
import { PlaceholderDetector } from '../lib/market-intelligence/detectors/placeholder-detector.ts';
import { createDetectorRegistry } from '../lib/market-intelligence/registry/bootstrap.ts';
import { DetectorRegistry } from '../lib/market-intelligence/registry/detector-registry.ts';

test('registry registers, gets, lists, checks, unregisters, and clears detectors', () => {
  const registry = new DetectorRegistry();
  const detector = new PlaceholderDetector();
  registry.register(detector);
  assert.equal(registry.exists(detector.id), true);
  assert.equal(registry.get(detector.id), detector);
  assert.deepEqual(registry.listIds(), [detector.id]);
  assert.deepEqual(registry.list(), [detector]);
  assert.equal(registry.unregister(detector.id), true);
  assert.equal(registry.exists(detector.id), false);
  registry.register(detector);
  registry.clear();
  assert.deepEqual(registry.listIds(), []);
});

test('registry rejects duplicate detector ids', () => {
  const registry = new DetectorRegistry().register(new PlaceholderDetector());
  assert.throws(() => registry.register(new PlaceholderDetector()), /already registered/);
});

test('frozen registry rejects every mutation and returns immutable list snapshots', () => {
  const registry = createDetectorRegistry();
  const listed = registry.list();
  assert.equal(registry.frozen, true);
  assert.equal(Object.isFrozen(listed), true);
  assert.throws(() => registry.register(new PlaceholderDetector()), /frozen/);
  assert.throws(() => registry.unregister('infrastructure.placeholder'), /frozen/);
  assert.throws(() => registry.clear(), /frozen/);
});

test('bootstrap registers dormant reference detectors, then freezes', () => {
  const registry = createDetectorRegistry();
  const detector = registry.get('infrastructure.placeholder');
  assert.deepEqual(registry.listIds(), ['infrastructure.placeholder', 'session', 'atr', 'trend', 'range-levels', 'break-of-structure', 'liquidity-sweep', 'fair-value-gap', 'rejection-candle', 'volume-expansion', 'displacement', 'volatility-requirement', 'retest']);
  assert.equal(detector?.metadata.displayName, 'Placeholder Detector');
  assert.equal(detector?.metadata.deterministic, true);
  assert.equal(detector?.metadata.supportsReplay, true);
  assert.equal(detector?.metadata.experimental, true);
  assert.equal(detector?.metadata.enabledByDefault, false);
  assert.match(detector?.metadata.description ?? '', /no market analysis/i);
});
