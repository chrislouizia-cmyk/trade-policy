import { HISTORICAL_DECISION_SCHEMA_VERSION } from '@/types/historical-decision';

export const HISTORICAL_REPORT_SCHEMA_REGISTRY=Object.freeze({
  [HISTORICAL_DECISION_SCHEMA_VERSION]:Object.freeze({version:HISTORICAL_DECISION_SCHEMA_VERSION,status:'SUPPORTED' as const,parser:'historicalDecisionSnapshotV1Schema'}),
});
export type SupportedHistoricalReportVersion=keyof typeof HISTORICAL_REPORT_SCHEMA_REGISTRY;
export function isSupportedHistoricalReportVersion(value:unknown):value is SupportedHistoricalReportVersion{return typeof value==='string'&&Object.hasOwn(HISTORICAL_REPORT_SCHEMA_REGISTRY,value)}
