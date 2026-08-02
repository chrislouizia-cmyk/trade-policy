import {notFound,redirect} from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import HistoricalDecisionReport from '@/components/decision/HistoricalDecisionReport';
import {parseHistoricalDecisionSnapshot} from '@/lib/historical-decisions/schema';
import {createClient} from '@/lib/supabase/server';
import {recordServerBetaEvent} from '@/lib/server/beta-events';
import {getUserDisplayName} from '@/lib/user-display-name';
import type {HistoricalDecisionAiExplanation} from '@/types/historical-decision';

export default async function HistoricalReportPage({params}:{params:Promise<{reportId:string}>}){
  const {reportId}=await params,s=await createClient();const {data:{user}}=await s.auth.getUser();
  if(!user)redirect(`/client/login?next=${encodeURIComponent(`/history/${reportId}`)}`);
  const {data:row}=await s.from('decision_reports').select('id,schema_version,snapshot_json').eq('id',reportId).maybeSingle();if(!row)notFound();
  await recordServerBetaEvent(user.id,'SAVED_REPORT_REOPENED');
  const parsed=parseHistoricalDecisionSnapshot(row.snapshot_json),displayName=await getUserDisplayName(s,user);
  if(!parsed.ok){console.error('Unsupported historical Decision Report schema',{reportId,version:parsed.version,reason:parsed.reason});return <main className="container"><AppHeader eyebrow="TRADE POLICE / HISTORY" displayName={displayName} description="Saved Decision Report" userId={user.id}/><section className="card error-state"><h1>This saved report cannot be displayed safely.</h1><p>Its report format is not supported by this version of Trade Police. The saved data has not been changed.</p><a className="button-link" href="/history">Return to History</a></section></main>}
  const {data:aiRow}=await s.from('decision_report_ai_explanations').select('explanation_version,provider,model,prose,source_verdict,source_deterministic_fingerprint,created_at').eq('report_id',reportId).maybeSingle();
  const ai=aiRow?{reportId,explanationVersion:aiRow.explanation_version,provider:aiRow.provider??undefined,model:aiRow.model??undefined,prose:aiRow.prose,createdAt:aiRow.created_at,sourceVerdict:aiRow.source_verdict,sourceDeterministicFingerprint:aiRow.source_deterministic_fingerprint,authoritative:false} as HistoricalDecisionAiExplanation:null;
  return <main className="container historical-report-page"><AppHeader eyebrow="TRADE POLICE / HISTORY" displayName={displayName} description="Saved Decision Report" userId={user.id}/><nav aria-label="History breadcrumb"><a href="/history">← All saved reports</a></nav><HistoricalDecisionReport snapshot={parsed.snapshot} ai={ai}/></main>;
}
