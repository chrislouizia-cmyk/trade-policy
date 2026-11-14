import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const COMMUNITY_SHARE_CODES = ['baf23429-d2f4-4173-974d-4a4a7b766e3d'] as const;

type CommunityStrategy = {
  name: string;
  description: string;
  instruments: string[];
  timeframes: string;
  rules: number;
  shareCode: string;
};

async function getCommunityStrategies(): Promise<CommunityStrategy[]> {
  const admin = createAdminClient();
  const { data: shares, error } = await admin
    .from('strategy_shares')
    .select('id,share_code,current_version,status')
    .in('share_code', [...COMMUNITY_SHARE_CODES])
    .eq('status', 'ACTIVE');
  if (error) throw error;
  const result: CommunityStrategy[] = [];
  for (const share of shares ?? []) {
    const { data: version, error: versionError } = await admin
      .from('strategy_share_versions')
      .select('snapshot_json')
      .eq('share_id', share.id)
      .eq('version', share.current_version)
      .maybeSingle();
    if (versionError || !version) continue;
    const snapshot = version.snapshot_json as Record<string, unknown>;
    const instruments = Array.isArray(snapshot.instruments)
      ? snapshot.instruments.filter((value): value is string => typeof value === 'string').slice(0, 10)
      : [];
    result.push({
      name: String(snapshot.name ?? 'Community Strategy').slice(0, 100),
      description: String(snapshot.description ?? '').slice(0, 400),
      instruments,
      timeframes: [snapshot.trendTimeframe, snapshot.confirmationTimeframe, snapshot.entryTimeframe]
        .filter((value): value is string => typeof value === 'string').join(' / '),
      rules: Array.isArray(snapshot.rules) ? snapshot.rules.length : 0,
      shareCode: share.share_code,
    });
  }
  return result;
}

export default async function CommunityPage() {
  let strategies: CommunityStrategy[] = [];
  let unavailable = false;
  try {
    strategies = await getCommunityStrategies();
  } catch {
    unavailable = true;
  }
  return (
    <main className="container" style={{maxWidth: 960, margin: '0 auto', padding: '48px 20px'}}>
      <a href="/" style={{color: 'inherit'}}>Trade Police</a>
      <header style={{margin: '36px 0'}}>
        <p style={{letterSpacing: 2, opacity: .7}}>STRATEGY LIBRARY</p>
        <h1>Community Strategies</h1>
        <p>Free, experimental strategies shared for personal use. These are not verified
          by Trade Police and have no demonstrated performance guarantee.</p>
      </header>
      {unavailable && <p role="alert">The community library is temporarily unavailable.</p>}
      {!unavailable && strategies.length === 0 && <p>No community strategies are currently available.</p>}
      <div style={{display: 'grid', gap: 16}}>
        {strategies.map(strategy => (
          <article key={strategy.shareCode} style={{border: '1px solid #7776', borderRadius: 16, padding: 24}}>
            <p style={{fontSize: 12, letterSpacing: 1}}>FREE · EXPERIMENTAL · NOT VERIFIED</p>
            <h2>{strategy.name}</h2>
            <p>{strategy.description}</p>
            <p><strong>Markets:</strong> {strategy.instruments.join(', ')}</p>
            <p><strong>Timeframes:</strong> {strategy.timeframes} · <strong>Rules:</strong> {strategy.rules}</p>
            <p><strong>Share code:</strong> <code style={{overflowWrap:'anywhere'}}>{strategy.shareCode}</code></p>
            <p style={{fontSize: 13, opacity: .75}}>Use this code with Trade Police's strategy sharing workflow.
              Installation from this page is not yet enabled.</p>
          </article>
        ))}
      </div>
    </main>
  );
}
