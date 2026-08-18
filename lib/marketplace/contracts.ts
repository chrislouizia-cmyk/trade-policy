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
  installId:string;releaseId:string;installedStrategyId:string;chargedCents:0;entitlementMode:'SIMULATED_INTERNAL';active:false;
}>;
