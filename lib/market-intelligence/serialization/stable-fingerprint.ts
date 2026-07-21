const canonicalize = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)])) : value;

export const canonicalStringify = (value: unknown): string => JSON.stringify(canonicalize(value));

/** Stable FNV-1a 64-bit fingerprint for deterministic identities, not security. */
export function stableFingerprint(value: unknown): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of canonicalStringify(value)) { hash ^= BigInt(character.codePointAt(0)!); hash = BigInt.asUintN(64, hash * 0x100000001b3n); }
  return hash.toString(16).padStart(16, '0');
}
