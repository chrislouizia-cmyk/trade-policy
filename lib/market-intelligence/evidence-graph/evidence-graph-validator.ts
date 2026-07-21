import type { EvidenceGraph, EvidenceGraphValidationIssue, EvidenceGraphValidationResult } from './evidence-graph-types.ts';

export class EvidenceGraphValidator {
  validate(graph: EvidenceGraph): EvidenceGraphValidationResult {
    const issues: EvidenceGraphValidationIssue[] = [], nodeIds = new Set<string>(), edgeIds = new Set<string>();
    graph.nodes.forEach((node, index) => {
      if (nodeIds.has(node.id)) issues.push({ code: 'DUPLICATE_NODE_ID', path: `nodes[${index}].id`, message: `Duplicate node id: ${node.id}` });
      nodeIds.add(node.id);
    });
    graph.edges.forEach((item, index) => {
      if (edgeIds.has(item.id)) issues.push({ code: 'DUPLICATE_EDGE_ID', path: `edges[${index}].id`, message: `Duplicate edge id: ${item.id}` });
      edgeIds.add(item.id);
      if (!nodeIds.has(item.from)) issues.push({ code: 'MISSING_EDGE_SOURCE', path: `edges[${index}].from`, message: `Edge source does not exist: ${item.from}` });
      if (!nodeIds.has(item.to)) issues.push({ code: 'MISSING_EDGE_TARGET', path: `edges[${index}].to`, message: `Edge target does not exist: ${item.to}` });
      if (item.from === item.to) issues.push({ code: 'SELF_EDGE', path: `edges[${index}]`, message: `Self-referencing edge is not allowed: ${item.id}` });
    });
    const adjacency = new Map<string, string[]>();
    graph.edges.forEach((item) => adjacency.set(item.from, [...(adjacency.get(item.from) ?? []), item.to]));
    const visiting = new Set<string>(), visited = new Set<string>();
    const cyclic = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const next of adjacency.get(id) ?? []) if (cyclic(next)) return true; visiting.delete(id); visited.add(id); return false; };
    if (graph.nodes.some((node) => cyclic(node.id))) issues.push({ code: 'GRAPH_CYCLE', path: 'edges', message: 'Evidence graph must be acyclic.' });
    return { valid: issues.length === 0, issues };
  }
}
