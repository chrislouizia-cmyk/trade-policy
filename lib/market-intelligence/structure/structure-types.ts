import type { Iso8601String, JsonObject } from '../contracts.ts';
import type { ConfirmedSwing } from '../detectors/confirmed-swing/confirmed-swing-types.ts';

export type SwingStructureLabel = 'INITIAL_HIGH' | 'INITIAL_LOW' | 'HH' | 'HL' | 'LH' | 'LL' | 'EH' | 'EL';
export type StructureBias = 'UNDEFINED' | 'BULLISH' | 'BEARISH' | 'MIXED';
export type SameDirectionReplacementPolicy = 'KEEP_FIRST' | 'KEEP_EXTREME' | 'KEEP_ALL';
export type OutsideCandlePolicy = 'PROCESS_HIGH_THEN_LOW' | 'PROCESS_LOW_THEN_HIGH' | 'REJECT_AMBIGUOUS';

export type StructureReducerConfig = JsonObject & {
  equalityToleranceAbsolute: number;
  equalityToleranceRelative: number;
  minimumSwingSeparationBars: number;
  sameDirectionReplacementPolicy: SameDirectionReplacementPolicy;
  outsideCandlePolicy: OutsideCandlePolicy;
};

export type ClassifiedSwing = JsonObject & {
  id: string;
  swing: ConfirmedSwing;
  label: SwingStructureLabel;
  previousComparableSwingId: string | null;
  comparisonDelta: number;
  accepted: boolean;
  rejectionReason: string | null;
  replacementOfSwingId: string | null;
  processedAt: Iso8601String;
};

export type StructureSnapshot = JsonObject & {
  id: string;
  processedAt: Iso8601String | null;
  lastConfirmedHigh: ClassifiedSwing | null;
  lastConfirmedLow: ClassifiedSwing | null;
  previousConfirmedHigh: ClassifiedSwing | null;
  previousConfirmedLow: ClassifiedSwing | null;
  latestHighLabel: SwingStructureLabel | null;
  latestLowLabel: SwingStructureLabel | null;
  bias: StructureBias;
  evidence: string[];
  sourceSwingIds: string[];
};

export type StructureStateResult = JsonObject & {
  reducerVersion: string;
  classifiedSwings: ClassifiedSwing[];
  snapshots: StructureSnapshot[];
  finalSnapshot: StructureSnapshot;
  warnings: string[];
  configuration: StructureReducerConfig;
};

export type IncrementalStructureReducer = Readonly<{
  pushSwing(swing: ConfirmedSwing): readonly ClassifiedSwing[];
  getNewClassifications(): readonly ClassifiedSwing[];
  getCurrentSnapshot(): StructureSnapshot;
  getAllClassifiedSwings(): readonly ClassifiedSwing[];
  getSnapshots(): readonly StructureSnapshot[];
  getWarnings(): readonly string[];
  getResult(): StructureStateResult;
  reset(): void;
}>;
