import type { MarketContext, MarketDataSnapshot } from '../contracts.ts';
import type { MarketDataRequest } from '../providers/market-data-provider.ts';
import type { DetectorRunSummary } from '../types/detector.ts';
import { analysisError } from './analysis-errors.ts';

export type AnalysisRequest = {
  marketDataRequest: MarketDataRequest;
  providerId: string;
  detectorIds: readonly string[];
};

export type MarketDataGatewayPort = { fetchSnapshot(providerId: string, request: MarketDataRequest): Promise<MarketDataSnapshot> };
export type DetectorRunnerPort = { execute(snapshot: MarketDataSnapshot, detectorIds: readonly string[]): Promise<DetectorRunSummary> };
export type ContextBuilderPort = { build(snapshot: MarketDataSnapshot, summary: DetectorRunSummary): MarketContext };

export class AnalysisOrchestrator {
  readonly #gateway: MarketDataGatewayPort;
  readonly #runner: DetectorRunnerPort;
  readonly #contextBuilder: ContextBuilderPort;

  constructor(
    gateway: MarketDataGatewayPort,
    runner: DetectorRunnerPort,
    contextBuilder: ContextBuilderPort,
  ) { this.#gateway = gateway; this.#runner = runner; this.#contextBuilder = contextBuilder; }

  async analyze(request: AnalysisRequest): Promise<MarketContext> {
    let snapshot: MarketDataSnapshot;
    try { snapshot = await this.#gateway.fetchSnapshot(request.providerId, request.marketDataRequest); }
    catch (error) { throw analysisError('MARKET_DATA', error); }

    let summary: DetectorRunSummary;
    try { summary = await this.#runner.execute(snapshot, request.detectorIds); }
    catch (error) { throw analysisError('DETECTORS', error); }

    try { return this.#contextBuilder.build(snapshot, summary); }
    catch (error) { throw analysisError('CONTEXT', error); }
  }
}
