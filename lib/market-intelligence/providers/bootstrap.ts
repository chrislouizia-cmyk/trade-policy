import { ProviderRegistry } from './provider-registry.ts';
import { TwelveDataProvider } from './twelve-data-provider.ts';

/** Dormant Phase 0.75 provider registry; no production path imports it. */
export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(new TwelveDataProvider())
    .freeze();
}
