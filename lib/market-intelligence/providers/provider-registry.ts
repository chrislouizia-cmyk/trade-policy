import type { MarketDataProvider } from './market-data-provider.ts';

export class ProviderRegistry {
  readonly #providers = new Map<string, MarketDataProvider>();
  #frozen = false;

  register(provider: MarketDataProvider): this {
    if (this.#frozen) throw new Error('Provider registry is frozen.');
    if (this.#providers.has(provider.id)) throw new Error(`Provider already registered: ${provider.id}`);
    this.#providers.set(provider.id, provider);
    return this;
  }

  get(id: string): MarketDataProvider | undefined {
    return this.#providers.get(id);
  }

  exists(id: string): boolean {
    return this.#providers.has(id);
  }

  list(): readonly MarketDataProvider[] {
    return Object.freeze([...this.#providers.values()]);
  }

  freeze(): this {
    this.#frozen = true;
    return this;
  }

  get frozen(): boolean {
    return this.#frozen;
  }
}
