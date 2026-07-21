import type { MarketDetector } from '../types/detector.ts';

export class DetectorRegistry {
  readonly #detectors = new Map<string, MarketDetector>();
  #frozen = false;

  register(detector: MarketDetector): this {
    if (this.#frozen) throw new Error('Detector registry is frozen.');
    if (this.#detectors.has(detector.id)) throw new Error(`Detector already registered: ${detector.id}`);
    this.#detectors.set(detector.id, detector);
    return this;
  }

  unregister(id: string): boolean {
    if (this.#frozen) throw new Error('Detector registry is frozen.');
    return this.#detectors.delete(id);
  }

  get(id: string): MarketDetector | undefined {
    return this.#detectors.get(id);
  }

  list(): readonly MarketDetector[] {
    return Object.freeze([...this.#detectors.values()]);
  }

  listIds(): readonly string[] {
    return Object.freeze([...this.#detectors.keys()]);
  }

  exists(id: string): boolean {
    return this.#detectors.has(id);
  }

  clear(): void {
    if (this.#frozen) throw new Error('Detector registry is frozen.');
    this.#detectors.clear();
  }

  freeze(): this {
    this.#frozen = true;
    return this;
  }

  get frozen(): boolean {
    return this.#frozen;
  }
}
