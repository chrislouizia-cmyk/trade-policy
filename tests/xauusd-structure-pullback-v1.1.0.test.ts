import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auditXauusdStructurePullbackV110, composeXauusdStructurePullbackV110, XAUUSD_STRUCTURE_PULLBACK_V110_DNA_SHA256 } from '../lib/research/strategy-composition/xauusd-structure-pullback/index.ts';

const v100 = readFileSync('research/strategies/xauusd-structure-pullback/1.0.0/strategy-dna.json', 'utf8');
const raw = readFileSync('research/strategies/xauusd-structure-pullback/1.1.0/strategy-dna.json', 'utf8');
const dna = JSON.parse(raw) as Record<string, any>;
const governance = readFileSync('research/strategies/xauusd-structure-pullback/1.1.0/governance.md', 'utf8');
const manifest = JSON.parse(readFileSync('research/strategies/xauusd-structure-pullback/1.1.0/manifest.json', 'utf8')) as Record<string, any>;
const digest = (v: string) => createHash('sha256').update(v).digest('hex');

test('v1.0.0 remains byte-identical with its frozen hash', () => assert.equal(digest(v100), '6ddfec4c112b22535dec5d9660a81e49e4de54d9d4336e0c8c0564000fc05d40'));
test('v1.1.0 has a distinct frozen raw SHA-256', () => { assert.equal(digest(raw), XAUUSD_STRUCTURE_PULLBACK_V110_DNA_SHA256); assert.notEqual(digest(raw), digest(v100)); });
test('v1.1.0 declares its parent and semantic governance reason', () => { assert.equal(dna.parentStrategyVersion, '1.0.0'); assert.match(dna.governanceReason, /before any official backtest/); });
test('manifest freezes the same checksum and denies an official run', () => { assert.equal(manifest.strategyArtifactSha256, digest(raw)); assert.equal(manifest.officialBacktestAuthorized, false); });
test('governance covers every clarified rule without performance data', () => { for (const term of ['sweep', 'FVG', 'displacement', 'rejects', 'session', 'Structural stop', 'liquidity', 'Minimum RR', 'One entry', 'exits']) assert.match(governance, new RegExp(term, 'i')); assert.match(governance, /No backtest results were examined or used/); });
test('LONG and SHORT rules are separately directional', () => { assert.equal(dna.rules.directional.LONG.requiredSweepSide, 'SELL_SIDE'); assert.equal(dna.rules.directional.SHORT.requiredSweepSide, 'BUY_SIDE'); assert.equal(dna.rules.directional.LONG.transitionDirection, 'BULLISH'); assert.equal(dna.rules.directional.SHORT.transitionDirection, 'BEARISH'); });
test('sweep chronology, age, source relation, lifecycle and selector are exact', () => { const r = dna.rules.sweepRelationship; assert.equal(r.sequence, 'BEFORE_TRANSITION'); assert.equal(r.sameCandleAllowed, false); assert.equal(r.maximumCompletedCandles, 8); assert.equal(r.consumedSourceEligible, true); assert.equal(r.multiplePolicy, 'LATEST_DETECTED_AT_THEN_STABLE_ID'); });
test('FVG association is exact and deterministic', () => { const r = dna.rules.fvgAssociation; assert.equal(r.transitionCandleRole, 'C2'); assert.equal(r.c3CompletedCandlesAfterTransition, 1); assert.deepEqual(r.eligibleStatusesAtTrigger, ['ACTIVE', 'PARTIALLY_MITIGATED']); assert.deepEqual(r.selection, ['EARLIEST_DETECTED_AT', 'STABLE_FVG_ID']); });
test('displacement remains strict and binds immutable evidence', () => { const r = dna.rules.displacement; assert.equal(r.source, 'IMMUTABLE_DISPLACEMENT_OBSERVATION'); assert.equal(r.atrPeriod, 14); assert.equal(r.minimumBodyRangeRatioExclusive, .65); assert.equal(r.minimumBodyAtrMultipleExclusive, 1.1); });
test('rejection geometry and entry-zone equality are executable', () => { assert.equal(dna.rules.entryZone.source, 'ENTIRE_ORIGINAL_FVG'); assert.equal(dna.rules.entryZone.boundaryEqualityQualifies, true); assert.equal(dna.rules.rejectionTrigger.LONG.closeLocation, 'CLOSE_GTE_ZONE_MIDPOINT'); assert.equal(dna.rules.rejectionTrigger.SHORT.closeLocation, 'CLOSE_LTE_ZONE_MIDPOINT'); });
test('session boundaries, UTC weekdays, DST and next-open are exact', () => { const s = dna.rules.session; assert.equal(s.timezone, 'UTC'); assert.equal(s.startInclusive, true); assert.equal(s.endExclusive, true); assert.deepEqual(s.allowedWeekdaysUtc, [1,2,3,4,5]); assert.equal(dna.rules.entryTiming.sameCandleExecution, false); });
test('combined structural stop formula and missing-component behavior are exact', () => { const s = dna.rules.stop; assert.match(s.LONG, /^MIN/); assert.match(s.SHORT, /^MAX/); assert.equal(s.bufferAtrMultiple, .1); assert.equal(s.missingComponent, 'BLOCKED'); assert.equal(s.fallback, null); });
test('target lifecycle, cluster and deterministic selection are exact', () => { const t = dna.rules.target; assert.deepEqual(t.eligibleStatuses, ['AVAILABLE', 'TESTED']); assert.equal(t.minimumClusterMembers, 2); assert.equal(t.searchFartherWhenNearestFailsMinimumRr, false); assert.deepEqual(t.selection, ['ABSOLUTE_DISTANCE', 'TYPE_PRIORITY', 'DETECTED_AT', 'STABLE_TARGET_ID']); });
test('RR formulas require positive distances and inclusive equality', () => { const r = dna.rules.minimumRewardToRisk; assert.equal(r.minimumInclusive, 2); assert.equal(r.riskMustBePositive, true); assert.equal(r.rewardMustBePositive, true); assert.equal(r.nearestTargetFailureStatus, 'INVALID'); });
test('structure identity and immutable consumption are exact', () => { const r = dna.rules.oneEntryPerStructure; assert.equal(r.identity, 'TRANSITION_REGIME_ID_ELSE_TRANSITION_EVENT_ID'); assert.equal(r.consumeAt, 'ENTRY_FILL'); assert.equal(r.stateSource, 'IMMUTABLE_STRUCTURE_CONSUMPTION_RECORDS'); assert.equal(r.persistsAcrossSessions, true); });
test('setup invalidation, holding, exit precedence and gaps are explicit', () => { assert.ok(dna.rules.setupInvalidation.includes('FVG_TERMINAL_BEFORE_ENTRY')); assert.equal(dna.rules.maximumHolding.completedCandles, 32); assert.deepEqual(dna.rules.exit.precedence, ['STRUCTURAL_CLOSE_INVALIDATION','STOP','TARGET','MAXIMUM_HOLDING']); assert.match(dna.rules.exit.gapThroughStop, /CANDLE_OPEN/); assert.match(dna.rules.exit.gapThroughTarget, /TARGET_PRICE/); });
test('readiness reports all semantics executable but engine integration honestly blocked', () => { const a = auditXauusdStructurePullbackV110(raw); assert.equal(a.mandatoryRuleCount, 15); assert.equal(a.executableRuleCount, 15); assert.equal(a.unsupportedRuleCount, 0); assert.equal(a.ambiguousRuleCount, 0); assert.equal(a.compositionSupported, true); assert.equal(a.executionMappingReady, false); assert.equal(a.officialBacktestAllowed, false); });
test('empty evidence is deterministic INCOMPLETE rather than semantically BLOCKED', () => {
  const input = { strategyDna: raw, referenceTimestamp: '2026-01-05T12:00:00.000Z', direction: 'LONG' as const, symbol: 'XAUUSD', timeframe: 'M15', candles: [], structureSnapshots: [], transitionEvents: [], sweepEvents: [], displacementObservations: [], fairValueGaps: [], stopCandidates: [], liquidityTargets: [] };
  const a = composeXauusdStructurePullbackV110(input), b = composeXauusdStructurePullbackV110(input);
  assert.equal(a.setup.status, 'INCOMPLETE'); assert.deepEqual(a, b); assert.equal(a.setup.conditionEvaluations.length, 15); assert.equal(a.fingerprint, b.fingerprint);
});
test('hash mismatch remains an explicit BLOCKED condition', () => {
  const result = composeXauusdStructurePullbackV110({ strategyDna: `${raw}\n`, referenceTimestamp: '2026-01-05T12:00:00.000Z', direction: 'SHORT', symbol: 'XAUUSD', timeframe: 'M15', candles: [], structureSnapshots: [], transitionEvents: [], sweepEvents: [], displacementObservations: [], fairValueGaps: [], stopCandidates: [], liquidityTargets: [] });
  assert.equal(result.setup.status, 'BLOCKED'); assert.ok(result.setup.blockingReasons.includes('STRATEGY_DNA_HASH_MISMATCH'));
});
test('v1.1.0 composition and governance import no AI or production routes', () => {
  const source = readFileSync('lib/research/strategy-composition/xauusd-structure-pullback/xauusd-structure-pullback-v1.1.0-composer.ts', 'utf8');
  assert.doesNotMatch(source, /from ['"].*(\/ai\/|\/app\/|\/routes?\/|\/ui\/)/i); assert.doesNotMatch(source, /Date\.now|Math\.random|randomUUID/);
});
