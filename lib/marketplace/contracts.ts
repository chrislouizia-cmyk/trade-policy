export type MarketplaceSourceType='INTERNAL_TRADE_POLICE'|'CUSTOMER_BETA';
export type MarketplaceEligibilityStatus='PRIVATE'|'OBSERVING'|'INSUFFICIENT_DATA'|'QUALIFIED'|'NOT_QUALIFIED'|'OWNER_CONSENT_PENDING'|'OWNER_DECLINED'|'UNDER_REVIEW'|'APPROVED'|'LISTED'|'ELIGIBILITY_WAIVED';
/** Public commerce is intentionally not implemented: future licensees use the
 * immutable release server-side and never receive an editable strategy copy. */
export type MarketplaceLicenseBoundary=Readonly<{licenseModel:'RENTAL';rights:'USE_INSIDE_TRADE_POLICE';transferable:false;resellable:false;sourceAccess:false;reverseEngineeringAllowed:false}>;
/** Safe marketplace-facing contract. It intentionally cannot reconstruct a strategy. */
export type MarketplaceListingSummary=Readonly<{
  listingId:string;releaseId:string;strategyName:string;creatorName:string|null;category:string|null;
  instruments:readonly string[];timeframeRoles:Readonly<{macro:string|null;execution:string|null}>;
  ruleCounts:Readonly<{total:number;required:number;optional:number;automatic:number;manual:number;external:number}>;
  compatibility:'COMPATIBLE'|'NEEDS_REVIEW'|'UNAVAILABLE';displayPriceCents:3000;creatorShareCents:1500;platformShareCents:1500;commerceEnabled:false;
}>;

export type MarketplaceReleasePreview=Readonly<{
  releaseId:string;releaseVersion:number;creatorName:string|null;listing:MarketplaceListingSummary;
  reviewStatus:'DRAFT'|'IN_REVIEW'|'APPROVED'|'REJECTED'|'ARCHIVED';
  usage:Readonly<{installs:number;analyses:number;decisions:number;trades:number}>;
  scores:Readonly<{performance:number|null;marketplaceReadiness:number|null;scoreVersion:string|null}>;
}>;

export type MarketplaceInstallResult=Readonly<{
  installId:string;releaseId:string;installedStrategyId:string;chargedCents:0;entitlementMode:'SIMULATED_INTERNAL';active:false;internalTest:true;
}>;

export type MarketplaceQualificationPolicy=Readonly<{
  version:string;minimumObservationDays:number;minimumClosedTrades:number;minimumAdherencePercent:number;maximumCriticalViolations:number;maximumDrawdownR:number;
}>;

export type MarketplaceCandidatePreview=Readonly<{
  candidateId:string;strategyId:string;strategyRevisionId:string;strategyName:string;ownerName:string|null;
  instruments:readonly string[];status:'OBSERVING'|'INSUFFICIENT_DATA'|'QUALIFIED'|'OWNER_CONSENT_PENDING'|'UNDER_REVIEW'|'APPROVED'|'DECLINED'|'ARCHIVED';
  consentStatus:'NOT_REQUESTED'|'PENDING'|'GRANTED'|'DECLINED'|'REVOKED';
  observationDays:number;completedBacktests:number;savedDecisions:number;closedTrades:number;
  adherencePercent:number|null;criticalViolations:number;maximumDrawdownR:number|null;
  policy:MarketplaceQualificationPolicy;
}>;
