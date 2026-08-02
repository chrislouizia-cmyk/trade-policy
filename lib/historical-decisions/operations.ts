import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export const REPORT_FAILURE_CODES=['AUTHENTICATION_FAILED','SOURCE_EXPIRED','SOURCE_NOT_FOUND','STRATEGY_REVISION_MISMATCH','FINGERPRINT_FAILURE','DATABASE_UNAVAILABLE','IDEMPOTENCY_CONFLICT','UNKNOWN_SAFE_ERROR'] as const;
export type ReportFailureCode=typeof REPORT_FAILURE_CODES[number];

export async function recordReportFailure(input:{reasonCode:ReportFailureCode;requestId:string;userId?:string|null;sourceAnalysisId?:string|null;retryable:boolean}){
  try{await createAdminClient().rpc('record_decision_report_failure',{p_reason_code:input.reasonCode,p_request_id:input.requestId,p_user_id:input.userId??null,p_source_analysis_id:input.sourceAnalysisId??null,p_retryable:input.retryable})}catch{console.error('Sanitized Decision Report failure telemetry was unavailable.',{requestId:input.requestId,reasonCode:input.reasonCode})}
}
