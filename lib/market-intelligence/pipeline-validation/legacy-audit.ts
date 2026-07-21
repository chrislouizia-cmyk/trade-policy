import type { PipelineAuditEntry } from './pipeline-types.ts';

export const LEGACY_PIPELINE_AUDIT: readonly PipelineAuditEntry[] = Object.freeze([
  ['timeframes.*.bias','SMA(10)/SMA(24) strict classification','Trend','timeframe roles','trend','EXACTLY_AVAILABLE',true,''],
  ['timeframes.*.atr','SIMPLE ATR(14), rounded for legacy display','ATR',null,'atr','EXACTLY_AVAILABLE',true,'Projection comparison uses unrounded detector value and explicit display rounding where required.'],
  ['timeframes.*.lastSwingHigh/Low','max/min slice(-8,-1)','Range Levels',null,'range-levels','EXACTLY_AVAILABLE',true,'Legacy names are rolling levels, not pivots.'],
  ['timeframes.*.bosUp/bosDown','strict close break','BOS',null,'break-of-structure','EXACTLY_AVAILABLE',true,''],
  ['timeframes.*.sweepHigh/sweepLow','strict wick through and close inside','Liquidity Sweep',null,'liquidity-sweep','EXACTLY_AVAILABLE',true,''],
  ['timeframes.*.fvgBullish/fvgBearish','latest versus candle -3','Fair Value Gap',null,'fair-value-gap','EXACTLY_AVAILABLE',true,''],
  ['timeframes.*.retest','bias-selected level within max tolerance','Retest',null,'retest','EXACTLY_AVAILABLE',true,''],
  ['direction/timeframeAligned','configured macro/trend/confirmation alignment','Trend','strategy timeframe roles','composition','STRATEGY_LAYER_REQUIRED',true,''],
  ['liquiditySweep/bosConfirmed','direction-filtered cross-timeframe OR','Sweep and BOS','direction and timeframe roles','composition','COMPOSABLE',true,''],
  ['chochConfirmed','directionalSweep && directionalBos','Sweep and BOS','direction and timeframe roles','composition','COMPOSABLE',true,'No temporal ordering in legacy.'],
  ['premiumDiscount','directional entry midpoint comparison','Range Levels','direction, entry and execution roles','composition','COMPOSABLE',true,'SELL includes equality.'],
  ['fairValueGap/retestConfirmed','directional/cross-timeframe OR','FVG and Retest','direction and timeframe roles','composition','COMPOSABLE',true,''],
  ['displacement/rejectionCandle/volumeConfirmation/volatilityRequirement','execution/trigger observations','Dedicated detectors','execution role','detectors','EXACTLY_AVAILABLE',true,''],
  ['setupReadiness/tradingDnaReport/liveAnalysisConfidence','Trading DNA runtime','composed evidence','active strategy rules','strategy runtime','STRATEGY_LAYER_REQUIRED',true,'Independent validation projection not yet implemented.'],
  ['status/analysisStatus','readiness-derived status','composed evidence','active strategy','strategy runtime','STRATEGY_LAYER_REQUIRED',true,''],
  ['breakdown/components/warnings','scoring and configured rule modes','composed evidence','active strategy','strategy runtime','STRATEGY_LAYER_REQUIRED',true,''],
  ['candidates','direction, BOS, retest, stops and risk policy','market observations','strategy and risk policy','strategy engine','STRATEGY_LAYER_REQUIRED',true,'Must never be produced by detector layer.'],
  ['calculatedAt','new Date().toISOString()', 'none',null,null,'NON_DETERMINISTIC',false,'Display-only timestamp; excluded from parity-critical fields.'],
  ['summary/setupType/layerAnalysis/timeframeBiases','derived display fields','market observations','strategy roles','composition/read model','COMPOSABLE',false,'Display-only once authoritative fields match.'],
].map(([legacyField,sourceCalculation,marketObservation,strategyContext,newEquivalent,parityStatus,productionInfluencing,notes]) => ({ legacyField, sourceCalculation, marketObservation, strategyContext, newEquivalent, parityStatus, productionInfluencing, notes })) as PipelineAuditEntry[]);
