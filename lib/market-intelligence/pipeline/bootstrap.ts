import 'server-only';
import { AnalysisContextBuilder } from '../analysis/analysis-context-builder.ts';
import { createProviderRegistry } from '../providers/bootstrap.ts';
import { MarketDataGateway } from '../providers/gateway.ts';
import { createDetectorRegistry } from '../registry/bootstrap.ts';
import { DetectorRunner } from '../runner/detector-runner.ts';
import { createCompositionRuleRegistry } from '../strategy-composition/bootstrap.ts';
import { CompositionRuleRunner } from '../strategy-composition/composition-rule-runner.ts';
import { IntelligencePipelineOrchestrator } from './intelligence-pipeline-orchestrator.ts';

export function createIntelligencePipelineInfrastructure() { const providerRegistry = createProviderRegistry(); const detectorRegistry = createDetectorRegistry(); const compositionRegistry = createCompositionRuleRegistry(); const gateway = new MarketDataGateway(providerRegistry); const runner = new DetectorRunner(detectorRegistry); const contextBuilder = new AnalysisContextBuilder(); const compositionRunner = new CompositionRuleRunner(compositionRegistry); const orchestrator = new IntelligencePipelineOrchestrator({ gateway, runner, contextBuilder, compositionRunner }); return Object.freeze({ providerRegistry, detectorRegistry, compositionRegistry, gateway, runner, contextBuilder, compositionRunner, orchestrator }); }
