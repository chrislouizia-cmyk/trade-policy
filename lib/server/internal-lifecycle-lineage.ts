import 'server-only';

import {
  buildInternalLifecycleDecisionSnapshot,
  assertValidInternalLifecycleSourceIds,
  getInternalLifecycleScenarioConfig,
  type InternalLifecycleScenario,
  type InternalLifecycleDecisionLineage,
} from '../internal-lifecycle-lineage-core.ts';
import { createAdminClient } from '../supabase/admin.ts';

export {
  buildInternalLifecycleDecisionSnapshot,
  assertValidInternalLifecycleSourceIds,
  getInternalLifecycleScenarioConfig,
  type InternalLifecycleScenario,
  type InternalLifecycleDecisionLineage,
};

export async function resolveInternalLifecycleDecisionLineage(
  userId: string,
  scenario: InternalLifecycleScenario,
): Promise<InternalLifecycleDecisionLineage> {
  const admin = createAdminClient();
  const config = getInternalLifecycleScenarioConfig(scenario);

  const { data: reports } = await admin
    .from('decision_reports')
    .select('id, source_analysis_id, snapshot_json, created_at')
    .eq('user_id', userId)
    .eq('strategy_name', 'INTERNAL_LIFECYCLE_SMOKE_TEST')
    .order('created_at', { ascending: false })
    .limit(25);

  const match = (reports ?? []).find((report: any) => {
    const snapshot = report?.snapshot_json ?? {};
    const verdict = String(snapshot.verdict ?? '').toUpperCase();
    const overrideEligible = Boolean(snapshot?.finalRiskCheck?.overrideEligible);
    return verdict === config.verdict && overrideEligible === config.overrideEligible;
  });

  if (match && match.source_analysis_id) {
    const { data: source } = await admin
      .from('decision_report_sources')
      .select('id')
      .eq('user_id', userId)
      .eq('source_analysis_id', match.source_analysis_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (source?.id) {
      return {
        scenario,
        sourceDecisionId: source.id,
        sourceReportId: match.id,
        verdict: config.verdict,
        overrideEligible: config.overrideEligible,
        activationMode: config.activationMode,
      };
    }
  }

  const snapshot = buildInternalLifecycleDecisionSnapshot(scenario);
  const analysisId = crypto.randomUUID();
  const sourceDecisionId = crypto.randomUUID();
  const reportId = snapshot.reportId;
  const idempotencyKey = `internal-lifecycle-${scenario.toLowerCase()}-${Date.now()}-${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();

  const { error: scanError } = await admin.from('market_scans').insert({
    id: analysisId,
    user_id: userId,
    strategy_profile_id: null,
    instrument: snapshot.instrument,
    provider: 'INTERNAL_SMOKE_TEST',
    timeframes: ['1H'],
    analysis: {
      source: 'INTERNAL_LIFECYCLE_SMOKE_TEST',
      scenario,
      authoritativeVerdict: snapshot.verdict,
      overrideEligible: snapshot.finalRiskCheck.overrideEligible,
    },
    created_at: createdAt,
  });

  if (scanError) {
    throw new Error(`Could not prepare the internal smoke test lineage for ${scenario}: ${scanError.message}`);
  }

  const { data: source, error: sourceError } = await admin.from('decision_report_sources').insert({
    id: sourceDecisionId,
    user_id: userId,
    source_analysis_id: analysisId,
    strategy_id: null,
    schema_version: snapshot.schemaVersion,
    deterministic_fingerprint: snapshot.deterministicFingerprint,
    snapshot_json: snapshot,
    ai_explanation_json: null,
    created_at: createdAt,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  }).select('id').single();

  if (sourceError || !source?.id) {
    throw new Error(`Could not create the internal smoke test decision source for ${scenario}: ${sourceError?.message ?? 'source id missing'}`);
  }

  const { data: reportResult, error: reportError } = await admin.rpc('save_decision_report', {
    p_source_id: source.id,
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
  });

  if (reportError) {
    throw new Error(`Could not materialize the internal smoke test report for ${scenario}: ${reportError.message}`);
  }

  const reportRow = Array.isArray(reportResult) ? reportResult[0] : reportResult;

  return {
    scenario,
    sourceDecisionId: source.id,
    sourceReportId: reportRow?.report_id ?? reportId,
    verdict: config.verdict,
    overrideEligible: config.overrideEligible,
    activationMode: config.activationMode,
  };
}
