import 'server-only';
import { createAdminClient } from '../supabase/admin.ts';
import { refreshTraderLearning } from './trader-context.ts';

export async function processTraderIntelligenceQueue(options: { userId?: string; budgetMs?: number } = {}) {
  const admin = createAdminClient();
  const deadline = Date.now() + Math.min(options.budgetMs ?? 40_000, 45_000);
  let refreshed = 0, failed = 0;
  do {
    const claimed = await admin.rpc('claim_trader_intelligence_jobs', { p_limit: options.userId ? 1 : 5, p_user_id: options.userId ?? null });
    if (claimed.error) throw new Error('INTELLIGENCE_QUEUE_UNAVAILABLE');
    const jobs = (claimed.data ?? []) as Array<{ user_id: string; requested_version: number; lease_id: string }>;
    if (!jobs.length) break;
    const results = await Promise.all(jobs.map(async job => {
      const result = await refreshTraderLearning(admin, job.user_id);
      const finished = await admin.rpc('finish_trader_intelligence_job', { p_user_id: job.user_id, p_version: job.requested_version, p_lease_id: job.lease_id, p_success: result.updated });
      if (finished.error || !finished.data) return false;
      return result.updated;
    }));
    refreshed += results.filter(Boolean).length;
    failed += results.filter(value => !value).length;
    if (options.userId) break;
  } while (Date.now() < deadline - 20_000);
  return { refreshed, failed };
}
