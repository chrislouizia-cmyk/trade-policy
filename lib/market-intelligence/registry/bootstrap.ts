import { PlaceholderDetector } from '../detectors/placeholder-detector.ts';
import { SessionDetector } from '../detectors/session/session-detector.ts';
import { AtrDetector } from '../detectors/atr/atr-detector.ts';
import { TrendDetector } from '../detectors/trend/trend-detector.ts';
import { RangeLevelsDetector } from '../detectors/range-levels/range-levels-detector.ts';
import { BreakOfStructureDetector } from '../detectors/break-of-structure/break-of-structure-detector.ts';
import { LiquiditySweepDetector } from '../detectors/liquidity-sweep/liquidity-sweep-detector.ts';
import { FairValueGapDetector } from '../detectors/fair-value-gap/fair-value-gap-detector.ts';
import { RejectionCandleDetector } from '../detectors/rejection-candle/rejection-candle-detector.ts';
import { VolumeExpansionDetector } from '../detectors/volume-expansion/volume-expansion-detector.ts';
import { DisplacementDetector } from '../detectors/displacement/displacement-detector.ts';
import { VolatilityRequirementDetector } from '../detectors/volatility-requirement/volatility-requirement-detector.ts';
import { RetestDetector } from '../detectors/retest/retest-detector.ts';
import { DetectorRegistry } from './detector-registry.ts';

/** Dormant registry for Phase 0.5. It is not imported by production code. */
export function createDetectorRegistry(): DetectorRegistry {
  return new DetectorRegistry()
    .register(new PlaceholderDetector())
    .register(new SessionDetector())
    .register(new AtrDetector())
    .register(new TrendDetector())
    .register(new RangeLevelsDetector())
    .register(new BreakOfStructureDetector())
    .register(new LiquiditySweepDetector())
    .register(new FairValueGapDetector())
    .register(new RejectionCandleDetector())
    .register(new VolumeExpansionDetector())
    .register(new DisplacementDetector())
    .register(new VolatilityRequirementDetector())
    .register(new RetestDetector())
    .freeze();
}
