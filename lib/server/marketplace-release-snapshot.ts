import 'server-only';

/** Server-only immutable source payload. Never return this from a marketplace route. */
export type MarketplaceReleaseSnapshot=Readonly<{
  releaseId:string;creatorUserId:string;sourceStrategyId:string;sourceStrategyRevisionId:string;releaseVersion:number;snapshotFingerprint:string;
  profile:Record<string,unknown>;instruments:readonly Record<string,unknown>[];sessions:readonly Record<string,unknown>[];rules:readonly Record<string,unknown>[];stopLimits:readonly Record<string,unknown>[];
}>;
