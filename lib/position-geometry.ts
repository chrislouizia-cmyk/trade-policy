import type { EntryCandidate } from '../types/trade.ts';

export type PositionGeometry = Readonly<{
  instrument: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
}>;

export type PositionGeometryField = 'instrument' | 'direction' | 'entry' | 'stopLoss' | 'takeProfit';
export type PositionOverlayModel = Readonly<{
  status: 'PROPOSED' | 'ACTIVE';
  selectedCandidateId: string | null;
  originalGeometry: PositionGeometry;
  currentGeometry: PositionGeometry;
  originalPlannedRR: number;
  acceptedGeometry: PositionGeometry | null;
  acceptedPlannedRR: number | null;
  geometryEdited: boolean;
  editedFields: readonly PositionGeometryField[];
  acceptedAt: string | null;
  activeTradeId: string | null;
  tradeRecordId: string | null;
}>;

export type GeometryAssessment = Readonly<{ valid: boolean; rr: number | null; reason: string | null }>;

export function assessPositionGeometry(geometry: PositionGeometry): GeometryAssessment {
  const values = [geometry.entry, geometry.stopLoss, geometry.takeProfit];
  if (!values.every(Number.isFinite)) return { valid: false, rr: null, reason: 'Entry, stop loss, and take profit must be valid prices.' };
  const valid = geometry.direction === 'BUY'
    ? geometry.stopLoss < geometry.entry && geometry.entry < geometry.takeProfit
    : geometry.takeProfit < geometry.entry && geometry.entry < geometry.stopLoss;
  if (!valid) return { valid: false, rr: null, reason: geometry.direction === 'BUY' ? 'Long setup requires Stop Loss < Entry < Take Profit.' : 'Short setup requires Take Profit < Entry < Stop Loss.' };
  const risk = Math.abs(geometry.entry - geometry.stopLoss);
  const reward = Math.abs(geometry.takeProfit - geometry.entry);
  return { valid: risk > 0, rr: risk > 0 ? Number((reward / risk).toFixed(4)) : null, reason: risk > 0 ? null : 'Risk distance must be greater than zero.' };
}

export function proposedPositionFromCandidate(instrument: string, candidate: EntryCandidate): PositionOverlayModel | null {
  const entry = candidate.entryLow ?? candidate.entryHigh;
  if (entry == null || candidate.stopLoss == null || candidate.takeProfit == null) return null;
  const geometry: PositionGeometry = { instrument, direction: candidate.direction, entry, stopLoss: candidate.stopLoss, takeProfit: candidate.takeProfit };
  const assessment = assessPositionGeometry(geometry);
  const originalPlannedRR = candidate.rr ?? assessment.rr;
  if (originalPlannedRR == null) return null;
  return Object.freeze({ status: 'PROPOSED', selectedCandidateId: candidate.id || null, originalGeometry: geometry, currentGeometry: geometry, originalPlannedRR, acceptedGeometry: null, acceptedPlannedRR: null, geometryEdited: false, editedFields: Object.freeze([]), acceptedAt: null, activeTradeId: null, tradeRecordId: null });
}

export function updateProposedGeometry(model: PositionOverlayModel, patch: Partial<PositionGeometry>): PositionOverlayModel {
  if (model.status !== 'PROPOSED') return model;
  const currentGeometry = { ...model.currentGeometry, ...patch };
  const fields = (Object.keys(patch) as PositionGeometryField[]).filter((field) => currentGeometry[field] !== model.originalGeometry[field]);
  const stillEdited = (Object.keys(currentGeometry) as PositionGeometryField[]).filter((field) => currentGeometry[field] !== model.originalGeometry[field]);
  return Object.freeze({ ...model, currentGeometry: Object.freeze(currentGeometry), geometryEdited: stillEdited.length > 0, editedFields: Object.freeze([...new Set([...model.editedFields.filter((field) => stillEdited.includes(field)), ...fields])]) });
}

export function activatePositionOverlay(model: PositionOverlayModel, identity: { activeTradeId: string; tradeRecordId: string | null; acceptedAt: string }): PositionOverlayModel {
  const assessment = assessPositionGeometry(model.currentGeometry);
  if (!assessment.valid || assessment.rr == null) throw new Error(assessment.reason ?? 'Position geometry is invalid.');
  return Object.freeze({ ...model, status: 'ACTIVE', acceptedGeometry: Object.freeze({ ...model.currentGeometry }), acceptedPlannedRR: assessment.rr, acceptedAt: identity.acceptedAt, activeTradeId: identity.activeTradeId, tradeRecordId: identity.tradeRecordId });
}

export function positionOverlayProvenance(model: PositionOverlayModel, acceptedAt: string) {
  const assessment = assessPositionGeometry(model.currentGeometry);
  if (!assessment.valid || assessment.rr == null) throw new Error(assessment.reason ?? 'Position geometry is invalid.');
  return {
    selectedCandidateId: model.selectedCandidateId,
    originalProposedGeometry: model.originalGeometry,
    originalPlannedRR: model.originalPlannedRR,
    acceptedGeometry: model.currentGeometry,
    acceptedPlannedRR: assessment.rr,
    geometryEdited: model.geometryEdited,
    editedFields: [...model.editedFields],
    acceptedAt,
  };
}
