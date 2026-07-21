import type { JsonObject } from '../contracts.ts';

export type EvidenceGraphNodeType = 'STRATEGY' | 'TIMEFRAME_ROLE' | 'TIMEFRAME' | 'RULE_CONFIGURATION' | 'RULE_EVALUATION' | 'DETECTOR_OBSERVATION' | 'DETECTOR_EVIDENCE';
export type EvidenceGraphEdgeType = 'CONFIGURES' | 'USES_TIMEFRAME_ROLE' | 'RESOLVES_TO_TIMEFRAME' | 'EVALUATED_AS' | 'REFERENCES_OBSERVATION' | 'CONTAINS_EVIDENCE';

export type EvidenceGraphNode = {
  id: string;
  type: EvidenceGraphNodeType;
  label: string;
  data: JsonObject;
};

export type EvidenceGraphEdge = {
  id: string;
  type: EvidenceGraphEdgeType;
  from: string;
  to: string;
};

export type EvidenceGraph = {
  graphId: string;
  graphVersion: '1.0.0';
  strategyId: string;
  strategyVersion: string;
  marketContextId: string;
  strategyContextId: string;
  generatedAt: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  warnings: string[];
};

export type EvidenceGraphValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type EvidenceGraphValidationResult = {
  valid: boolean;
  issues: EvidenceGraphValidationIssue[];
};
