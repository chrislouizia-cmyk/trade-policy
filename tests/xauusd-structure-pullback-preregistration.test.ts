import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalStringify } from '../lib/market-intelligence/serialization/stable-fingerprint.ts';
import { validateResearchStrategyCandidate, type ResearchStrategyCandidate } from '../lib/market-intelligence-lab/strategy-registry/research-candidate-validation.ts';

const root = 'research/strategies/xauusd-structure-pullback/1.0.0';
const bytes = readFileSync(`${root}/strategy-dna.json`);
const candidate = JSON.parse(bytes.toString('utf8')) as ResearchStrategyCandidate;
const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8')) as Record<string, unknown>;
const clone = (patch: Partial<ResearchStrategyCandidate>): ResearchStrategyCandidate => structuredClone({ ...candidate, ...patch });
const sha256 = (file: string): string => createHash('sha256').update(readFileSync(`${root}/${file}`)).digest('hex');

test('candidate is complete but correctly blocked on detector implementation', () => {
  const result = validateResearchStrategyCandidate(candidate);
  assert.equal(result.valid, true);
  assert.equal(result.status, 'DETECTOR_IMPLEMENTATION_REQUIRED');
  assert.equal(candidate.status, 'DETECTOR_IMPLEMENTATION_REQUIRED');
  assert.deepEqual(
    ['entry', 'stop', 'target', 'invalidation', 'maximumHolding', 'sessions'].filter((field) => candidate[field as keyof ResearchStrategyCandidate] === null),
    [],
  );
  assert.equal(candidate.direction, 'BOTH');
  assert.equal(candidate.executableMapping, null);
  assert.equal(existsSync(`${root}/executable-mapping.json`), false);
});

test('hashing and canonical serialization are exact and reproducible', () => {
  const first = validateResearchStrategyCandidate(candidate);
  const reordered = Object.fromEntries(Object.entries(candidate).reverse()) as ResearchStrategyCandidate;
  assert.equal(first.strategyHash, '5b5960212e3a8ab0');
  assert.equal(first.strategyHash, manifest.strategyHash);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.strategyArtifactSha256);
  const artifactHashes = manifest.artifacts as Record<string, string>;
  assert.equal(sha256('hypothesis.md'), artifactHashes.hypothesisSha256);
  assert.equal(sha256('preregistration.md'), artifactHashes.preregistrationSha256);
  assert.equal(sha256('detector-dependency-audit.md'), artifactHashes.detectorDependencyAuditSha256);
  assert.equal(first.canonicalStrategy, canonicalStringify(candidate));
  assert.equal(validateResearchStrategyCandidate(JSON.parse(JSON.stringify(candidate))).strategyHash, first.strategyHash);
  assert.equal(canonicalStringify(reordered), canonicalStringify(candidate));
});

test('dependency report covers every required concept and prevents unsupported readiness', () => {
  const statuses = Object.fromEntries(candidate.dependencies.map((dependency) => [dependency.concept, dependency.status]));
  assert.deepEqual(statuses, {
    'swing-high': 'UNSUPPORTED',
    'swing-low': 'UNSUPPORTED',
    'break-of-structure': 'PARTIALLY_SUPPORTED',
    'market-structure-shift': 'UNSUPPORTED',
    'fair-value-gap': 'PARTIALLY_SUPPORTED',
    'liquidity-sweep': 'PARTIALLY_SUPPORTED',
    'structural-stop-placement': 'UNSUPPORTED',
    'liquidity-target-detection': 'UNSUPPORTED',
  });
  const falselyReady = validateResearchStrategyCandidate(clone({ status: 'READY_FOR_RESEARCH' }));
  assert.equal(falselyReady.valid, false);
  assert.match(falselyReady.issues.join(' '), /DETECTOR_IMPLEMENTATION_REQUIRED/);
});

test('silent rule substitution and demonstration defaults are rejected', () => {
  const substituted = validateResearchStrategyCandidate(clone({ substitutions: [{ required: 'market-structure-shift', substitute: 'EMA_RELATION' }] }));
  assert.equal(substituted.valid, false);
  assert.match(substituted.issues.join(' '), /substitutions are prohibited/);
  const assumptions = { ...candidate.executionAssumptions, source: 'DEMONSTRATION_DEFAULT' };
  const demonstration = validateResearchStrategyCandidate(clone({ executionAssumptions: assumptions }));
  assert.equal(demonstration.valid, false);
  assert.match(demonstration.issues.join(' '), /execution assumptions|Demonstration defaults/i);
});

test('immutable research metadata freezes execution and forbids an official run', () => {
  assert.equal(candidate.researchMetadata.immutable, true);
  assert.equal(candidate.researchMetadata.parameterOptimizationPerformed, false);
  assert.equal(candidate.executionAssumptions.source, 'EXPLICIT_IMMUTABLE_STRATEGY');
  assert.equal(manifest.mappingHash, null);
  assert.equal(manifest.officialBacktestAuthorized, false);
  assert.equal((manifest.governance as Record<string, unknown>).demonstrationDefaultsAllowed, false);
});
