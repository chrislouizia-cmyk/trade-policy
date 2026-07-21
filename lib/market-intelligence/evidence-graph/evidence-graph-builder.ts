import type { JsonObject, MarketContext } from '../contracts.ts';
import type { StrategyContext } from '../strategy-composition/composition-types.ts';
import type { CompiledStrategyDefinition } from '../strategy-definitions/strategy-definition-types.ts';
import type { EvidenceGraph, EvidenceGraphEdge, EvidenceGraphNode } from './evidence-graph-types.ts';

const nodeId = (...parts: (string | number)[]): string => parts.map(String).join(':');
const edge = (type: EvidenceGraphEdge['type'], from: string, to: string): EvidenceGraphEdge => ({ id: `edge:${type.toLowerCase()}:${from}:${to}`, type, from, to });
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const uniqueById = <T extends { id: string }>(values: readonly T[]): T[] => [...new Map(values.map((value) => [value.id, value])).values()];
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }

export class EvidenceGraphBuilder {
  build(definition: CompiledStrategyDefinition, marketContext: MarketContext, strategyContext: StrategyContext): EvidenceGraph {
    if (definition.id !== strategyContext.strategyId || definition.version !== strategyContext.strategyVersion) throw new Error('Compiled strategy definition does not match StrategyContext identity.');
    if (marketContext.contextId !== strategyContext.marketContextId) throw new Error('MarketContext does not match StrategyContext source identity.');
    if (marketContext.requestedAt !== strategyContext.executionTimestamp) throw new Error('StrategyContext execution timestamp does not match MarketContext requestedAt.');

    const nodes: EvidenceGraphNode[] = [], edges: EvidenceGraphEdge[] = [], warnings: string[] = [...strategyContext.warnings];
    const strategyNode = nodeId('strategy', definition.id, definition.version);
    nodes.push({ id: strategyNode, type: 'STRATEGY', label: definition.name, data: { strategyId: definition.id, strategyVersion: definition.version, tradingStyle: definition.tradingStyle } });

    const rolesByTimeframe = new Map<string, string[]>();
    for (const [role, timeframe] of Object.entries(definition.timeframeRoles)) {
      rolesByTimeframe.set(timeframe, [...(rolesByTimeframe.get(timeframe) ?? []), role]);
      const roleNode = nodeId('timeframe-role', role);
      nodes.push({ id: roleNode, type: 'TIMEFRAME_ROLE', label: role, data: { role, timeframe } });
    }

    const observationNodes = new Map<number, string>(), evidenceNodes = new Set<string>();
    for (const evaluation of strategyContext.ruleResults) {
      const ruleNode = nodeId('rule', evaluation.ruleId);
      const evaluationNode = nodeId('rule-evaluation', evaluation.ruleId);
      const configuration = definition.ruleConfiguration?.[evaluation.ruleId] ?? {};
      nodes.push({ id: ruleNode, type: 'RULE_CONFIGURATION', label: evaluation.ruleId, data: { ruleId: evaluation.ruleId, requirement: definition.ruleRequirements?.[evaluation.ruleId] ?? 'OPTIONAL', parameters: structuredClone(configuration) } });
      nodes.push({ id: evaluationNode, type: 'RULE_EVALUATION', label: `${evaluation.ruleId}: ${evaluation.status}`, data: { ruleId: evaluation.ruleId, ruleVersion: evaluation.ruleVersion, status: evaluation.status, matched: evaluation.matched, confidenceContribution: evaluation.confidenceContribution, explanation: evaluation.explanation } });
      edges.push(edge('CONFIGURES', strategyNode, ruleNode), edge('EVALUATED_AS', ruleNode, evaluationNode));

      const configuredTimeframe = typeof configuration.timeframe === 'string' ? configuration.timeframe : undefined;
      const configuredRole = typeof configuration.timeframeRole === 'string' ? configuration.timeframeRole : undefined;
      const resolvedRoles = configuredRole ? [configuredRole] : configuredTimeframe ? rolesByTimeframe.get(configuredTimeframe) ?? [] : [];
      for (const role of resolvedRoles) {
        const roleNode = nodeId('timeframe-role', role);
        edges.push(edge('USES_TIMEFRAME_ROLE', ruleNode, roleNode), edge('RESOLVES_TO_TIMEFRAME', roleNode, nodeId('timeframe', configuredTimeframe!)));
      }

      for (const reference of evaluation.evidenceReferences) {
        const source = marketContext.detectorResults[reference.resultIndex];
        if (!source || source.detectorId !== reference.detectorId || source.timeframe !== reference.timeframe) {
          warnings.push(`Unresolved evidence reference for rule ${evaluation.ruleId}: ${reference.detectorId}/${reference.timeframe} at index ${reference.resultIndex}.`);
          continue;
        }
        let observationNode = observationNodes.get(reference.resultIndex);
        if (!observationNode) {
          observationNode = nodeId('observation', reference.resultIndex, source.detectorId, source.timeframe);
          observationNodes.set(reference.resultIndex, observationNode);
          nodes.push({ id: observationNode, type: 'DETECTOR_OBSERVATION', label: `${source.detectorId} ${source.timeframe}`, data: { detectorId: source.detectorId, detectorVersion: source.detectorVersion, timeframe: source.timeframe, resultIndex: reference.resultIndex, status: source.status, runId: source.runId } });
        }
        edges.push(edge('REFERENCES_OBSERVATION', evaluationNode, observationNode));
        for (const evidenceId of reference.evidenceIds) {
          const sourceEvidence = source.evidence.find((item) => item.id === evidenceId);
          if (!sourceEvidence) { warnings.push(`Detector evidence ${evidenceId} was not found for ${source.detectorId}/${source.timeframe}.`); continue; }
          const evidenceNode = nodeId('evidence', reference.resultIndex, evidenceId);
          if (!evidenceNodes.has(evidenceNode)) {
            evidenceNodes.add(evidenceNode);
            nodes.push({ id: evidenceNode, type: 'DETECTOR_EVIDENCE', label: sourceEvidence.description, data: { evidenceId, evidenceType: sourceEvidence.type, detectorId: source.detectorId, timeframe: source.timeframe, sourceReference: sourceEvidence.sourceReference ?? null } });
          }
          edges.push(edge('CONTAINS_EVIDENCE', observationNode, evidenceNode));
        }
      }
    }
    const timeframeNodes = unique(edges.filter((item) => item.type === 'RESOLVES_TO_TIMEFRAME').map((item) => item.to));
    for (const id of timeframeNodes) nodes.push({ id, type: 'TIMEFRAME', label: id.slice('timeframe:'.length), data: { timeframe: id.slice('timeframe:'.length) } });
    return deepFreeze({ graphId: `evidence-graph:${strategyContext.contextId}`, graphVersion: '1.0.0', strategyId: definition.id, strategyVersion: definition.version, marketContextId: marketContext.contextId, strategyContextId: strategyContext.contextId, generatedAt: strategyContext.executionTimestamp, nodes: uniqueById(nodes), edges: uniqueById(edges), warnings: unique(warnings) });
  }
}
