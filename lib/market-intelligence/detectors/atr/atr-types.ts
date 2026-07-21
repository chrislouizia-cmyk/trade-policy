import type { AtrObservation } from '../../contracts.ts';
export type AtrSmoothingMethod = AtrObservation['smoothingMethod'];
export type AtrDetectorOptions = { period?: number };
