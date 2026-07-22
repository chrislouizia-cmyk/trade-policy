import type { CompiledStrategyDefinition } from '../../market-intelligence/strategy-definitions/strategy-definition-types.ts';
import { stableFingerprint } from '../../market-intelligence/serialization/stable-fingerprint.ts';

function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }

/** Minimum research registry: exactly one immutable, content-addressed strategy version. */
export class ImmutableStrategyRegistry {
  readonly #strategy: CompiledStrategyDefinition;
  readonly definitionHash: string;
  constructor(strategy: CompiledStrategyDefinition) { this.#strategy = deepFreeze(structuredClone(strategy)); this.definitionHash = stableFingerprint(this.#strategy); Object.freeze(this); }
  get(id: string, version: string): CompiledStrategyDefinition | undefined { return id === this.#strategy.id && version === this.#strategy.version ? this.#strategy : undefined; }
  require(id: string, version: string): CompiledStrategyDefinition { const strategy = this.get(id, version); if (!strategy) throw new Error(`Immutable strategy version was not found: ${id}@${version}`); return strategy; }
  list(): readonly CompiledStrategyDefinition[] { return Object.freeze([this.#strategy]); }
}
