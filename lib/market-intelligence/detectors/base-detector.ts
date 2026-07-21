import type { JsonValue } from '../contracts.ts';
import type { DetectorMetadata, MarketDetector } from '../types/detector.ts';

/** Shared immutable metadata implementation for future detectors. */
export abstract class BaseDetector<TPayload extends JsonValue = JsonValue>
implements MarketDetector<TPayload> {
  readonly metadata: DetectorMetadata;

  protected constructor(metadata: DetectorMetadata) {
    this.metadata = Object.freeze({
      ...metadata,
      supportedTimeframes: Object.freeze([...metadata.supportedTimeframes]),
    }) as DetectorMetadata;
  }

  get id(): string { return this.metadata.id; }
  get version(): string { return this.metadata.version; }
  get displayName(): string { return this.metadata.displayName; }
  get deterministic(): boolean { return this.metadata.deterministic; }
  get supportedTimeframes(): readonly string[] { return this.metadata.supportedTimeframes; }

  abstract execute(
    snapshot: import('../contracts.ts').MarketDataSnapshot,
  ): Promise<import('../contracts.ts').DetectorResult<TPayload>>;
}
