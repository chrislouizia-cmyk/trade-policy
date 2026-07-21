import { createProviderRegistry } from '../providers/bootstrap.ts';
import { MarketDataGateway } from '../providers/gateway.ts';
import { createDetectorRegistry } from '../registry/bootstrap.ts';
import { DetectorRunner } from '../runner/detector-runner.ts';
import { AnalysisContextBuilder } from './analysis-context-builder.ts';
import { AnalysisOrchestrator } from './analysis-orchestrator.ts';

/** Builds the dormant Phase 0.9 graph. It performs no analysis until analyze() is called explicitly. */
export function createAnalysisInfrastructure() {
  const providerRegistry = createProviderRegistry();
  const gateway = new MarketDataGateway(providerRegistry);
  const detectorRegistry = createDetectorRegistry();
  const runner = new DetectorRunner(detectorRegistry);
  const contextBuilder = new AnalysisContextBuilder();
  const orchestrator = new AnalysisOrchestrator(gateway, runner, contextBuilder);
  return Object.freeze({ providerRegistry, gateway, detectorRegistry, runner, contextBuilder, orchestrator });
}
