import type { EvidenceGraph } from './evidence-graph-types.ts';
import { EvidenceGraphValidator } from './evidence-graph-validator.ts';
import { canonicalStringify } from '../serialization/stable-fingerprint.ts';

export class EvidenceGraphSerializer {
  readonly #validator = new EvidenceGraphValidator();
  serialize(graph: EvidenceGraph): string {
    const result = this.#validator.validate(graph);
    if (!result.valid) throw new Error(`Cannot serialize invalid evidence graph: ${result.issues.map((issue) => issue.message).join(' ')}`);
    return canonicalStringify(graph);
  }
}
