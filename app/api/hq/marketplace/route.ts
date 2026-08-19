import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { strategyRevisionId } from '@/lib/historical-decisions/strategy-revision';
import { loadStrategyById } from '@/lib/server/active-strategy';
import { getHQMarketplaceContext, toMarketplacePreview } from '@/lib/server/hq-marketplace';

export const dynamic = 'force-dynamic';

const safeCode = (error: unknown) => {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  return code === '42P01' || code === 'PGRST205' ? 'MARKETPLACE_SCHEMA_UNAVAILABLE' : 'MARKETPLACE_CATALOG_UNAVAILABLE';
};

const logSupabaseQueryFailure = (label: string, error: unknown) => {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  console.error('[HQ marketplace catalog query failure]', {
    label,
    code:typeof candidate?.code==='string'?candidate.code:null,
    message:typeof candidate?.message==='string'?candidate.message:null,
    details:typeof candidate?.details==='string'?candidate.details:null,
    hint:typeof candidate?.hint==='string'?candidate.hint:null,
  });
};

const strategyPreviewSnapshot = (profile: any) => ({
  id: profile?.id ?? null,
  name: typeof profile?.name === 'string' ? profile.name : '',
  marketTypes: Array.isArray(profile?.market_types) ? profile.market_types.filter((value: unknown): value is string => typeof value === 'string') : [],
  instruments: Array.isArray(profile?.instruments) ? profile.instruments.filter((value: unknown): value is string => typeof value === 'string') : [],
  macroTimeframe: typeof profile?.macro_timeframe === 'string' ? profile.macro_timeframe : null,
  trendTimeframe: typeof profile?.trend_timeframe === 'string' ? profile.trend_timeframe : null,
  confirmationTimeframe: typeof profile?.confirmation_timeframe === 'string' ? profile.confirmation_timeframe : null,
  entryTimeframe: typeof profile?.entry_timeframe === 'string' ? profile.entry_timeframe : null,
  triggerTimeframe: typeof profile?.trigger_timeframe === 'string' ? profile.trigger_timeframe : null,
  minimumRR: Number(profile?.minimum_rr ?? 0),
  maximumRiskPercent: Number(profile?.maximum_risk_percent ?? 0),
  allowedSessions: Array.isArray(profile?.allowed_sessions) ? profile.allowed_sessions.filter((value: unknown): value is string => typeof value === 'string') : [],
  requiredEvidence: Array.isArray(profile?.required_evidence) ? profile.required_evidence.filter((value: unknown): value is string => typeof value === 'string') : [],
  createdAt: profile?.created_at ?? null,
  updatedAt: profile?.updated_at ?? null,
});

const buildProtectedStrategySnapshot = (profile: any) => ({
  ...strategyPreviewSnapshot(profile),
  stopLimits: profile?.stop_limits && typeof profile.stop_limits === 'object' ? profile.stop_limits : {},
  evidenceWeights: profile?.evidence_weights && typeof profile.evidence_weights === 'object' ? profile.evidence_weights : {},
  requiredEvidence: Array.isArray(profile?.required_evidence) ? profile.required_evidence.filter((value: unknown): value is string => typeof value === 'string') : [],
});

const buildSanitizedMetadata = (profile: any) => ({
  strategyName: typeof profile?.name === 'string' ? profile.name : 'Internal test strategy',
  creatorName: 'Trade Police',
  category: Array.isArray(profile?.market_types) && profile.market_types.length ? profile.market_types[0] : 'INTERNAL_TEST',
  instruments: Array.isArray(profile?.instruments) ? profile.instruments.filter((value: unknown): value is string => typeof value === 'string') : [],
  macroTimeframe: typeof profile?.macro_timeframe === 'string' ? profile.macro_timeframe : null,
  executionTimeframe: typeof profile?.entry_timeframe === 'string' ? profile.entry_timeframe : null,
  compatibility: 'COMPATIBLE',
  ruleCounts: {
    total: 0,
    required: 0,
    optional: 0,
    automatic: 0,
    manual: 0,
    external: 0,
  },
  sourceType: 'INTERNAL_TRADE_POLICE',
  eligibilityStatus: 'ELIGIBILITY_WAIVED',
  internalTest: true,
  commerceEnabled: false,
});

export async function GET(request:Request) {
  try {
    await getHQMarketplaceContext();
  } catch {
    return NextResponse.json({ error: 'Marketplace Lab access denied.', code: 'FORBIDDEN' }, { status: 403 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('mode') === 'profiles') {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, { status: 401 });

      const { data: isFounder, error: founderError } = await supabase.rpc('is_owner');
      if (founderError || !isFounder) {
        return NextResponse.json({ isFounder: false, profiles: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      const admin = createAdminClient();
      const { data: internalStaffRows, error: internalStaffError } = await admin
        .from('staff_roles')
        .select('user_id')
        .eq('is_active', true);

      if (internalStaffError) {
        logSupabaseQueryFailure('internal_staff_profiles', internalStaffError);
        return NextResponse.json({ error: 'Trade Police internal strategy directory unavailable.', code: 'STRATEGY_PROFILE_ERROR' }, { status: 503 });
      }

      const internalUserIds = [...new Set((internalStaffRows ?? []).map((row: any) => row.user_id).filter((value): value is string => typeof value === 'string'))];
      if (internalUserIds.length === 0) {
        return NextResponse.json({ isFounder: true, profiles: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      const { data: profiles, error: profilesError } = await admin
        .from('strategy_profiles')
        .select('id,name,is_default,is_archived,instruments,market_types,macro_timeframe,trend_timeframe,confirmation_timeframe,entry_timeframe,trigger_timeframe,minimum_rr,maximum_risk_percent,allowed_sessions,required_evidence,engine_version,created_at,updated_at')
        .in('user_id', internalUserIds)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(100);

      if (profilesError) {
        logSupabaseQueryFailure('profiles', profilesError);
        return NextResponse.json({ error: 'Strategy profile directory unavailable.', code: 'STRATEGY_PROFILE_ERROR' }, { status: 503 });
      }

      return NextResponse.json({
        isFounder: true,
        profiles: (profiles ?? []).map((profile: any) => ({
          id: profile.id,
          name: profile.name,
          instruments: Array.isArray(profile.instruments) ? profile.instruments.filter((value: unknown): value is string => typeof value === 'string') : [],
          marketTypes: Array.isArray(profile.market_types) ? profile.market_types.filter((value: unknown): value is string => typeof value === 'string') : [],
          timeframeRoles: {
            macro: typeof profile.macro_timeframe === 'string' ? profile.macro_timeframe : null,
            trend: typeof profile.trend_timeframe === 'string' ? profile.trend_timeframe : null,
            confirmation: typeof profile.confirmation_timeframe === 'string' ? profile.confirmation_timeframe : null,
            entry: typeof profile.entry_timeframe === 'string' ? profile.entry_timeframe : null,
            trigger: typeof profile.trigger_timeframe === 'string' ? profile.trigger_timeframe : null,
          },
          createdAt: profile.created_at ?? null,
        })),
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      console.error('[HQ marketplace profiles access failure]', error);
      return NextResponse.json({ error: 'Strategy profile directory unavailable.', code: 'STRATEGY_PROFILE_ERROR' }, { status: 503 });
    }
  }

  try {
    const admin = createAdminClient();
    const { data: listings, error: listingsError } = await admin
      .from('marketplace_listings')
      .select('id,release_id,review_status,sanitized_metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    if (listingsError) {
      logSupabaseQueryFailure('listings', listingsError);
      throw listingsError;
    }

    const releaseIds = [...new Set((listings ?? []).map((row: any) => row.release_id).filter((value): value is string => Boolean(value)))];
    const releaseById = new Map<string, any>();
    if (releaseIds.length > 0) {
      const { data: releases, error: releasesError } = await admin.from('marketplace_strategy_releases').select('id,release_version').in('id', releaseIds);
      if (releasesError) {
        logSupabaseQueryFailure('releases', releasesError);
        throw releasesError;
      }
      for (const row of releases ?? []) {
        if (!row.id) continue;
        releaseById.set(row.id, row);
      }
    }

    const rankingByRelease = new Map<string, any>();
    if (releaseIds.length > 0) {
      const { data: rankings, error: rankingsError } = await admin
        .from('marketplace_release_rankings')
        .select('release_id,score_version,performance_score,marketplace_readiness_score,rank_position,calculated_at')
        .in('release_id', releaseIds)
        .order('calculated_at', { ascending: false });
      if (rankingsError) {
        logSupabaseQueryFailure('rankings', rankingsError);
        throw rankingsError;
      }
      for (const row of rankings ?? []) {
        if (!row.release_id || rankingByRelease.has(row.release_id)) continue;
        rankingByRelease.set(row.release_id, row);
      }
    }

    return NextResponse.json({
      items: (listings ?? []).map((row: any) => toMarketplacePreview({
        ...row,
        release_version: releaseById.get(row.release_id)?.release_version ?? 0,
        marketplace_release_rankings: rankingByRelease.has(row.release_id) ? [rankingByRelease.get(row.release_id)] : [],
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = safeCode(error);
    return NextResponse.json({
      error: code === 'MARKETPLACE_SCHEMA_UNAVAILABLE' ? 'Marketplace schema unavailable.' : 'Marketplace catalog unavailable.',
      code,
      method:request.method,
    }, {status:503});
  }
}

export async function POST(request:Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { data: isFounder, error: founderError } = await supabase.rpc('is_owner');
  if (founderError || !isFounder) {
    return NextResponse.json({ error: 'Founder-only access required.', code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const strategyProfileId = typeof body.strategyProfileId === 'string' ? body.strategyProfileId.trim() : '';
  if (!strategyProfileId) {
    return NextResponse.json({ error: 'Strategy profile is required.', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: staffRows, error: staffRowsError } = await admin
    .from('staff_roles')
    .select('user_id')
    .eq('is_active', true);

  if (staffRowsError) {
    console.error('[HQ marketplace create failure]', { message: staffRowsError.message, strategyProfileId, userId: user.id });
    return NextResponse.json({ error: 'Trade Police internal strategy directory is unavailable.', code: 'STRATEGY_PROFILE_ERROR' }, { status: 503 });
  }

  const internalUserIds = [...new Set((staffRows ?? []).map((row: any) => row.user_id).filter((value): value is string => typeof value === 'string'))];
  const { data: sourceProfile, error: sourceError } = await admin
    .from('strategy_profiles')
    .select('id,user_id,name,market_types,instruments,macro_timeframe,trend_timeframe,confirmation_timeframe,entry_timeframe,trigger_timeframe,minimum_rr,maximum_risk_percent,allowed_sessions,required_evidence,evidence_weights,stop_limits,engine_version,created_at,updated_at,is_archived')
    .in('user_id', internalUserIds)
    .eq('id', strategyProfileId)
    .maybeSingle();

  if (sourceError) {
    console.error('[HQ marketplace create failure]', { message: sourceError.message, strategyProfileId, userId: user.id });
    return NextResponse.json({ error: 'Strategy profile lookup failed.', code: 'STRATEGY_PROFILE_ERROR' }, { status: 503 });
  }

  if (!sourceProfile) {
    return NextResponse.json({ error: 'Strategy profile not found or not Trade Police-owned.', code: 'NOT_FOUND' }, { status: 404 });
  }

  if (sourceProfile.is_archived) {
    return NextResponse.json({ error: 'Archived strategy profiles cannot be used for internal testing.', code: 'ARCHIVED_PROFILE' }, { status: 409 });
  }

  const canonicalStrategy = await loadStrategyById(admin, sourceProfile.user_id, sourceProfile.id);
  const sourceStrategyRevisionId = strategyRevisionId(canonicalStrategy);

  const { data: creationResult, error: creationError } = await supabase.rpc('create_internal_marketplace_release_v1', {
    p_strategy_profile_id: sourceProfile.id,
    p_source_strategy_revision_id: sourceStrategyRevisionId,
  });

  if (creationError) {
    const message = String(creationError.message ?? 'Internal test release creation failed.');
    if (message.includes('already exists for this strategy revision') || message.includes('already exists')) {
      return NextResponse.json({ error: 'An internal test release already exists for this strategy revision.', code: 'DUPLICATE_MARKETPLACE_RELEASE' }, { status: 409 });
    }
    if (message.includes('Archived strategy profile')) {
      return NextResponse.json({ error: 'Archived strategy profiles cannot be used for internal testing.', code: 'ARCHIVED_PROFILE' }, { status: 409 });
    }
    if (message.includes('not owned by an active Trade Police staff user') || message.includes('not found') || message.includes('not Trade Police-owned')) {
      return NextResponse.json({ error: 'Strategy profile not found or not Trade Police-owned.', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (message.includes('Founder permission required')) {
      return NextResponse.json({ error: 'Founder-only access required.', code: 'FORBIDDEN' }, { status: 403 });
    }
    console.error('[HQ marketplace create failure]', { message, strategyProfileId, userId: user.id });
    return NextResponse.json({ error: 'Internal test release could not be created.', code: 'RELEASE_CREATE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    release: {
      id: creationResult?.release_id ?? null,
      source_strategy_id: creationResult?.source_strategy_id ?? sourceProfile.id,
      source_strategy_revision_id: creationResult?.source_strategy_revision_id ?? sourceStrategyRevisionId,
      release_version: creationResult?.release_version ?? 1,
    },
    listing: {
      id: creationResult?.listing_id ?? null,
      release_id: creationResult?.release_id ?? null,
      review_status: creationResult?.review_status ?? 'APPROVED',
      sanitized_metadata: creationResult?.sanitized_metadata ?? buildSanitizedMetadata(sourceProfile),
    },
    preview: toMarketplacePreview({
      id: creationResult?.listing_id ?? null,
      release_id: creationResult?.release_id ?? null,
      release_version: creationResult?.release_version ?? 1,
      review_status: creationResult?.review_status ?? 'APPROVED',
      sanitized_metadata: creationResult?.sanitized_metadata ?? buildSanitizedMetadata(sourceProfile),
      marketplace_release_rankings: [],
      created_at: new Date().toISOString(),
    }),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
