/**
 * Server-side Automatic Market Intelligence feature-flag resolver.
 *
 * Keep environment access centralized here. The dormant Phase 0 module is not
 * imported by any production route or client component.
 */

export const AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY = 'AUTOMATIC_MARKET_INTELLIGENCE_V1';

/** Only the trimmed, case-insensitive string "true" enables the feature. */
export function resolveAutomaticMarketIntelligenceV1(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function isAutomaticMarketIntelligenceV1Enabled(): boolean {
  return resolveAutomaticMarketIntelligenceV1(process.env[AUTOMATIC_MARKET_INTELLIGENCE_V1_ENV_KEY]);
}

export type MarketIntelligenceV2Flags = { enabled: boolean; adminOnly: boolean; betaOnly: boolean; shadowMode: boolean; allowFallback: boolean };
export const MARKET_INTELLIGENCE_V2_ENV_KEYS = Object.freeze({ enabled: 'MARKET_INTELLIGENCE_V2_ENABLED', adminOnly: 'MARKET_INTELLIGENCE_V2_ADMIN_ONLY', betaOnly: 'MARKET_INTELLIGENCE_V2_BETA_ONLY', shadowMode: 'MARKET_INTELLIGENCE_V2_SHADOW_MODE', allowFallback: 'MARKET_INTELLIGENCE_V2_ALLOW_FALLBACK' });
const boolean = (value: string | undefined, fallback: boolean): boolean => value === undefined ? fallback : value.trim().toLowerCase() === 'true';
export function resolveMarketIntelligenceV2Flags(environment: Record<string, string | undefined>): MarketIntelligenceV2Flags { return Object.freeze({ enabled: boolean(environment[MARKET_INTELLIGENCE_V2_ENV_KEYS.enabled], false), adminOnly: boolean(environment[MARKET_INTELLIGENCE_V2_ENV_KEYS.adminOnly], true), betaOnly: boolean(environment[MARKET_INTELLIGENCE_V2_ENV_KEYS.betaOnly], true), shadowMode: boolean(environment[MARKET_INTELLIGENCE_V2_ENV_KEYS.shadowMode], true), allowFallback: boolean(environment[MARKET_INTELLIGENCE_V2_ENV_KEYS.allowFallback], true) }); }
export function marketIntelligenceV2Flags(): MarketIntelligenceV2Flags { return resolveMarketIntelligenceV2Flags(process.env); }
