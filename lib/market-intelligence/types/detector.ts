import type {
  DetectorResult,
  JsonValue,
  MarketDataSnapshot,
} from '../contracts.ts';

export type DetectorMetadata = {
  id: string;
  version: string;
  displayName: string;
  deterministic: boolean;
  supportedTimeframes: string[];
  supportsReplay: boolean;
  experimental: boolean;
  enabledByDefault: boolean;
  description: string;
};

/**
 * Pure market-observation boundary. Detectors cannot receive strategy, risk,
 * decision, AI, UI, HTTP, or persistence dependencies through this contract.
 */
export interface MarketDetector<TPayload extends JsonValue = JsonValue> {
  readonly metadata: DetectorMetadata;
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly deterministic: boolean;
  readonly supportedTimeframes: readonly string[];
  execute(snapshot: MarketDataSnapshot): Promise<DetectorResult<TPayload>>;
}

export type DetectorFailure = {
  detectorId: string;
  errorCode: string;
  message: string;
};

export type DetectorRunSummary = {
  runId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  detectorResults: DetectorResult[];
  detectorFailures: DetectorFailure[];
  successfulCount: number;
  failedCount: number;
};
