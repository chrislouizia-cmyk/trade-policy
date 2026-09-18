import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type PublicMarketplaceListing = {
  listingId: string;
  releaseId: string;
  name: string;
  creator: string;
  category: string;
  instruments: string[];
  macroTimeframe: string | null;
  executionTimeframe: string | null;
  observationDays: number | null;
  closedTrades: number | null;
  winRate: number | null;
  totalR: number | null;
  expectancyR: number | null;
  maxDrawdownR: number | null;
  adherenceRate: number | null;
  metricStatus: string;
  installed: boolean;
};

const numeric = (value: unknown) => value == null ? null : Number(value);

export async function getPublicMarketplace(userId: string): Promise<PublicMarketplaceListing[]> {
  const admin = createAdminClient();
  const { data: listings, error } = await admin.from('marketplace_listings')
    .select('id,release_id,sanitized_metadata,created_at')
    .eq('visibility', 'PUBLIC').eq('review_status', 'APPROVED')
    .order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  const releaseIds = (listings ?? []).map((item) => item.release_id);
  if (!releaseIds.length) return [];
  const [{ data: metrics }, { data: installs }] = await Promise.all([
    admin.from('marketplace_release_verified_metrics').select('*').in('marketplace_release_id', releaseIds),
    admin.from('marketplace_installs').select('release_id').eq('installer_user_id', userId).eq('status', 'INSTALLED').in('release_id', releaseIds),
  ]);
  const latestMetric = new Map<string, Record<string, unknown>>();
  for (const row of metrics ?? []) {
    const current = latestMetric.get(row.marketplace_release_id);
    if (!current || String(row.updated_at) > String(current.updated_at)) latestMetric.set(row.marketplace_release_id, row);
  }
  const installed = new Set((installs ?? []).map((row) => row.release_id));
  return (listings ?? []).map((listing) => {
    const meta = (listing.sanitized_metadata ?? {}) as Record<string, unknown>;
    const metric = latestMetric.get(listing.release_id) ?? {};
    return {
      listingId: listing.id,
      releaseId: listing.release_id,
      name: String(meta.strategyName ?? 'Verified strategy'),
      creator: String(meta.creatorName ?? 'Trade Police member'),
      category: String(meta.category ?? 'OTHER'),
      instruments: Array.isArray(meta.instruments) ? meta.instruments.map(String) : [],
      macroTimeframe: meta.macroTimeframe ? String(meta.macroTimeframe) : null,
      executionTimeframe: meta.executionTimeframe ? String(meta.executionTimeframe) : null,
      observationDays: numeric(metric.observation_days),
      closedTrades: metric.wins == null && metric.losses == null && metric.break_even == null
        ? null
        : Number(metric.wins ?? 0) + Number(metric.losses ?? 0) + Number(metric.break_even ?? 0),
      winRate: numeric(metric.win_rate),
      totalR: numeric(metric.total_r),
      expectancyR: numeric(metric.expectancy_r),
      maxDrawdownR: numeric(metric.max_drawdown_r),
      adherenceRate: numeric(metric.strategy_adherence_rate),
      metricStatus: String(metric.metric_status ?? 'NOT_ENOUGH_VERIFIED_DATA'),
      installed: installed.has(listing.release_id),
    };
  });
}

export async function getPublicMarketplaceListing(userId: string, listingId: string) {
  return (await getPublicMarketplace(userId)).find((item) => item.listingId === listingId) ?? null;
}
